const {chromium} = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const {openDatabase} = await import('../db.js');
  const {createApp} = await import('../server.js');
  const db = await openDatabase(null, ':memory:');
  const {app} = await createApp(
    {AUTH_MODE: 'demo', SEED_DEMO: 'true', OIDC_ISSUER: 'https://idp.example/oidc', LOG_LEVEL: 'warn'},
    db,
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  fs.mkdirSync('.impeccable/review', {recursive: true});
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport: {width: 1440, height: 1040}});
  const orderTitle = 'Browser check ' + Date.now();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.getByRole('link', {name: 'Enter demo workspace'}).click();
  await page.getByRole('heading', {name: 'Today', exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/desktop.png', fullPage: true});
  await page.locator('#search').focus();
  await page.screenshot({path: '.impeccable/review/desktop-search-focus.png', fullPage: true});
  await page.locator('#search').blur();
  await page.getByRole('button', {name: 'New request', exact: true}).click();
  const motion = await page.locator('#editor').evaluate(el => {
    const animations = el.getAnimations();
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = 60;
    }
    const computed = getComputedStyle(el);
    return {
      sampleMilliseconds: 60,
      name: computed.animationName,
      duration: computed.animationDuration,
      transform: computed.transform,
      opacity: computed.opacity,
      keyframes: animations.map(a => a.effect.getKeyframes()),
    };
  });
  fs.writeFileSync('.impeccable/review/editor-motion.json', JSON.stringify(motion, null, 2));
  await page.screenshot({path: '.impeccable/review/editor-opening.png', fullPage: true});
  await page.locator('#editor').evaluate(el => el.getAnimations().forEach(a => a.finish()));
  await page.getByLabel('What do you need?').fill(orderTitle);
  await page.locator('[name=building_id]').selectOption('b1');
  await page.getByLabel('Details').fill('Created by browser verification');
  await page.getByRole('button', {name: 'Create request', exact: true}).click();
  await page.locator('#editor').waitFor({state: 'hidden'});
  await page.locator('.order-title').filter({hasText: orderTitle}).waitFor();
  // Tickets open as their own page with an address; Back returns to the list.
  await page.locator('.order-title').filter({hasText: orderTitle}).click();
  await page.getByRole('heading', {name: orderTitle, exact: true}).waitFor();
  assert.match(new URL(page.url()).pathname, /^\/tickets\/WO-\d{4}$/, 'each ticket has its own URL');
  const ticketUrl = page.url();
  await page.getByRole('button', {name: 'Mark in progress', exact: true}).click();
  await page.locator('#ticket-page .tp-summary .tag.in-progress').waitFor();
  // Undo after a status change.
  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await page.locator('#ticket-page .tp-summary .tag.open').waitFor();
  await page.getByRole('button', {name: 'Mark in progress', exact: true}).click();
  await page.locator('#ticket-page .tp-summary .tag.in-progress').waitFor();
  // Ticket controls save on change; there is no separate save step. A keyboard arrow alone does not save.
  let patches = 0;
  const countPatch = r => r.request().method() === 'PATCH' && patches++;
  page.on('response', countPatch);
  await page.getByLabel('Status', {exact: true}).focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  assert.equal(patches, 0, 'an arrow key on a ticket control must not save');
  await page.screenshot({path: '.impeccable/review/order-control-keyboard-desktop.png'});
  await page.keyboard.press('Escape');
  await page.getByRole('heading', {name: orderTitle, exact: true}).click();
  page.off('response', countPatch);
  assert.equal(
    await page.locator('#ticket-page [name=status] option[value=Completed]').count(),
    0,
    'Completed is reached by Resolve',
  );
  assert.equal(await page.getByRole('button', {name: 'Put on hold', exact: true}).count(), 0);
  await page.getByLabel('Status', {exact: true}).selectOption('On hold');
  await page.locator('#ticket-page .tp-summary .tag.on-hold').waitFor();
  // Resolving asks for a note; it cannot be skipped.
  await page.getByRole('button', {name: 'Resolve', exact: true}).click();
  await page.locator('#resolve-form').getByRole('button', {name: 'Resolve', exact: true}).click();
  assert.equal(await page.locator('#editor').isVisible(), true, 'an empty note keeps the form open');
  await page.getByLabel('Resolution note').fill('Replaced the cartridge and tested the tap.');
  await page.screenshot({path: '.impeccable/review/resolve-desktop.png'});
  await page.locator('#resolve-form').getByRole('button', {name: 'Resolve', exact: true}).click();
  await page.locator('#ticket-page .tp-summary .tag.completed').waitFor();
  await page.getByText('Resolution: Replaced the cartridge and tested the tap.', {exact: true}).waitFor();
  await page.goBack();
  await page.locator('.order-title').first().waitFor();
  await page.goto(ticketUrl);
  await page.getByRole('heading', {name: orderTitle, exact: true}).waitFor();
  await page.getByLabel('Add a comment').fill('Browser verification completed.');
  await page.getByRole('button', {name: 'Post comment', exact: true}).click();
  await page.getByText('Browser verification completed.', {exact: true}).waitFor();
  // Checklist, time and saved replies on the ticket.
  await page.locator('#checklist-new').fill('Check the shut-off valve');
  await page.locator('#checklist-form').getByRole('button', {name: 'Add', exact: true}).click();
  await page.getByLabel('Check the shut-off valve', {exact: true}).check();
  await page.getByText('1 of 1 done', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Start timer', exact: true}).click();
  await page.locator('.timer-badge').waitFor();
  await page.screenshot({path: '.impeccable/review/ticket-tools-desktop.png', fullPage: true});
  await page.locator('.time-card [data-timer-stop]').click();
  await page.getByText(/Timer stopped: \d+ min logged\./).waitFor();
  assert.equal(await page.locator('.timer-badge').count(), 0);
  await page.getByRole('button', {name: 'Log time', exact: true}).click();
  await page.locator('#time-form').getByLabel('Minutes').fill('20');
  await page.locator('#time-form').getByRole('button', {name: 'Log time'}).click();
  await page.getByText('20 min logged.', {exact: true}).waitFor();
  await page.getByLabel('Add a comment').fill('We are on our way.');
  await page.getByRole('button', {name: 'Save as reply', exact: true}).click();
  await page.locator('#reply-form').getByLabel('Reply name').fill('On our way');
  await page.locator('#reply-form').getByRole('button', {name: 'Save reply'}).click();
  await page.getByText('Reply “On our way” saved.', {exact: true}).waitFor();
  assert.equal(await page.locator('#insert-reply option', {hasText: 'On our way'}).count(), 1);
  await page.getByRole('button', {name: 'Back', exact: true}).click();
  for (const name of ['Assets', 'Buildings', 'Preventive maintenance', 'Settings', 'Overview']) {
    await page.getByRole('button', {name, exact: true}).click();
  }
  await page.getByRole('button', {name: 'Schedule requests', exact: true}).click();
  await page.getByRole('button', {name: 'New schedule request', exact: true}).click();
  assert.equal(await page.getByLabel('Request type').inputValue(), 'schedule');
  await page.getByLabel('What do you need?').fill('Annual team meeting');
  await page.locator('[name=building_id]').selectOption('b2');
  await page.getByLabel('Starts').fill('2026-10-15T09:00');
  await page.getByLabel('Ends').fill('2026-10-15T10:00');
  await page.getByRole('button', {name: 'Create request', exact: true}).click();
  await page.locator('#editor').waitFor({state: 'hidden'});
  await page.getByText('Annual team meeting', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.screenshot({path: '.impeccable/review/settings-desktop.png', fullPage: true});
  await page.getByRole('switch', {name: 'Technology requests', exact: true}).uncheck();
  await page.getByRole('button', {name: 'Save settings', exact: true}).click();
  await page.getByText('Workspace settings saved.', {exact: true}).waitFor();
  assert.equal(
    await page.locator('#workspace-nav').getByRole('button', {name: 'Technology requests', exact: true}).count(),
    0,
  );
  await page.getByRole('button', {name: 'Overview', exact: true}).click();
  await page.getByRole('button', {name: 'New request', exact: true}).click();
  assert.equal(await page.locator('[name=request_type] option[value=technology]').count(), 0);
  await page.getByRole('button', {name: 'Close dialog'}).click();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('switch', {name: 'Technology requests', exact: true}).check();
  await page.getByRole('button', {name: 'Save settings', exact: true}).click();
  await page.getByText('Workspace settings saved.', {exact: true}).waitFor();
  await page.locator('#workspace-nav').getByRole('button', {name: 'Notifications', exact: true}).click();
  await page.getByRole('button', {name: 'Preferences', exact: true}).click();
  await page.getByRole('switch', {name: 'Comments', exact: true}).uncheck();
  await page.getByRole('button', {name: 'Save preferences', exact: true}).click();
  await page.getByText('Notification preferences saved.', {exact: true}).waitFor();
  assert.equal(await page.getByRole('switch', {name: 'Comments', exact: true}).isChecked(), false);
  await page.screenshot({path: '.impeccable/review/notifications-desktop.png', fullPage: true});
  await page.getByRole('button', {name: 'Overview', exact: true}).click();
  await page.getByRole('button', {name: 'View requests', exact: true}).click();
  await page.getByRole('heading', {name: 'All requests', exact: true}).waitFor();
  await page.getByText('Annual team meeting', {exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/aggregate-desktop.png', fullPage: true});
  // The topbar finder: "/" focuses it, a ticket number opens the ticket, words search the register.
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'top-search');
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await page.locator('#ticket-page .ticket-no').filter({hasText: 'WO-0002'}).waitFor();
  await page.getByRole('button', {name: 'Back', exact: true}).click();
  await page.locator('#top-search').fill('Annual team');
  await page.locator('#top-search').press('Enter');
  await page.getByRole('heading', {name: 'All requests', exact: true}).waitFor();
  assert.equal(await page.locator('#search').inputValue(), 'Annual team');
  await page.getByText('Annual team meeting', {exact: true}).waitFor();
  // Bulk updates: select rows, choose a stage, apply.
  await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/orders?') && !r.url().includes('q=')),
    page.locator('#search').fill(''),
  ]);
  await page.locator('#order-table [data-pick]').nth(1).waitFor();
  const picks = page.locator('#order-table [data-pick]');
  await picks.nth(0).check();
  await picks.nth(1).check();
  await page.getByText('2 selected', {exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/bulk-desktop.png', fullPage: false});
  await page.locator('#bulk-status').selectOption('On hold');
  await page.getByRole('button', {name: 'Apply to selected', exact: true}).click();
  await page.getByText('2 requests updated.', {exact: true}).waitFor();
  assert.equal(await page.locator('#bulk-bar').isHidden(), true, 'the bar closes once the selection is applied');
  // Bulk changes can be undone from the toast.
  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await page.getByText('Undone.', {exact: true}).waitFor();
  // The address follows the register, and a view pins it to the sidebar.
  await page.locator('[data-filter="Open"]').click();
  await page.waitForFunction(() => location.search.includes('view=orders') && location.search.includes('tab=Open'));
  await page.locator('[data-save-view]').click();
  await page.locator('#view-form').getByLabel('View name').fill('Open work');
  await page.locator('#view-form').getByRole('button', {name: 'Save view'}).click();
  await page.locator('#workspace-nav').getByRole('button', {name: 'Open work', exact: true}).waitFor();
  await page.locator('#workspace-nav').getByRole('button', {name: 'Overview', exact: true}).click();
  await page.locator('#workspace-nav').getByRole('button', {name: 'Open work', exact: true}).click();
  await page.getByRole('heading', {name: 'All requests', exact: true}).waitFor();
  assert.equal(await page.locator('[data-filter="Open"]').getAttribute('class'), 'selected');
  const shared = page.url();
  await page.goto(base);
  await page.goto(shared);
  await page.getByRole('heading', {name: 'All requests', exact: true}).waitFor();
  assert.equal(await page.locator('[data-filter="Open"]').getAttribute('class'), 'selected', 'links reopen the list');
  await page.screenshot({path: '.impeccable/review/views-desktop.png'});
  // Already reported? Similar open tickets in the same building appear while writing a request.
  await page.getByRole('button', {name: 'New request', exact: true}).click();
  await page.locator('#create-form [name=building_id]').selectOption('b1');
  await page.locator('#create-form').getByLabel('What do you need?').fill('Air conditioning not cooling');
  await page.locator('#similar').getByText('Already reported?').waitFor();
  await page.screenshot({path: '.impeccable/review/similar-desktop.png'});
  await page.getByRole('button', {name: 'Close dialog'}).click();
  await page.evaluate(() => localStorage.removeItem('facilities.draft.new-request'));
  // Command palette and shortcuts.
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('calend');
  await page.screenshot({path: '.impeccable/review/palette-desktop.png'});
  await page.keyboard.press('Enter');
  await page.getByRole('heading', {name: 'Calendar', exact: true}).waitFor();
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('wo-2');
  await page.keyboard.press('Enter');
  await page.locator('#ticket-page .ticket-no').filter({hasText: 'WO-0002'}).waitFor();
  await page.keyboard.press('?');
  await page.getByRole('heading', {name: 'Keyboard shortcuts', exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/shortcuts-desktop.png'});
  await page.keyboard.press('Escape');
  await page.locator('#editor').waitFor({state: 'hidden'});
  await page.keyboard.press('Escape');
  await page.locator('#ticket-page').waitFor({state: 'detached'});
  await page.keyboard.press('g');
  await page.keyboard.press('r');
  await page.getByRole('heading', {name: 'All requests', exact: true}).waitFor();
  await page.keyboard.press('j');
  assert.equal(await page.evaluate(() => document.activeElement.matches('tr[data-order]')), true, 'j moves to a row');
  // Drafts survive closing the sheet.
  await page.keyboard.press('n');
  await page.locator('#create-form').getByLabel('What do you need?').fill('Half-written request');
  await page.waitForTimeout(600);
  await page.getByRole('button', {name: 'Close dialog'}).click();
  await page.keyboard.press('n');
  await page.getByText('Draft restored.').waitFor();
  assert.equal(await page.locator('#create-form').getByLabel('What do you need?').inputValue(), 'Half-written request');
  await page.locator('#create-form').getByRole('button', {name: 'Discard draft'}).click();
  await page.getByRole('button', {name: 'Close dialog'}).click();
  // Dark theme from the palette.
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('dark theme');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.waitForTimeout(400);
  await page.screenshot({path: '.impeccable/review/dark-desktop.png', fullPage: true});
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('light theme');
  await page.keyboard.press('Enter');
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  for (const name of ['Maintenance requests', 'Schedule requests', 'Technology requests'])
    await page.getByRole('switch', {name, exact: true}).uncheck();
  await page.getByRole('button', {name: 'Save settings', exact: true}).click();
  await page
    .locator('#workspace-nav')
    .getByRole('button', {name: 'All requests', exact: true})
    .waitFor({state: 'hidden'});
  await page.getByRole('button', {name: 'Overview', exact: true}).click();
  await page.getByText('Request types are disabled. Your existing records are preserved.', {exact: false}).waitFor();
  await page.screenshot({path: '.impeccable/review/disabled-desktop.png', fullPage: true});
  await page.getByRole('button', {name: 'Configure request types', exact: true}).click();
  await page.getByRole('heading', {name: 'Workspace settings', exact: true}).waitFor();
  for (const name of ['Maintenance requests', 'Schedule requests', 'Technology requests'])
    await page.getByRole('switch', {name, exact: true}).check();
  await page.getByRole('button', {name: 'Save settings', exact: true}).click();
  await page.locator('#workspace-nav').getByRole('button', {name: 'Technology requests', exact: true}).waitFor();
  const mobile = await browser.newPage({viewport: {width: 390, height: 844}});
  await mobile.goto(base);
  await mobile.getByRole('link', {name: 'Enter demo workspace'}).click();
  await mobile.getByRole('heading', {name: 'Today', exact: true}).waitFor();
  await mobile.screenshot({path: '.impeccable/review/mobile-viewport.png'});
  // Full-page phone captures park the dock at the end so it hides nothing; the viewport capture keeps it.
  const parkDock = () =>
    mobile.evaluate(() => document.querySelector('.dock')?.style.setProperty('position', 'static'));
  await parkDock();
  await mobile.screenshot({path: '.impeccable/review/mobile.png', fullPage: true});
  await mobile.getByRole('button', {name: 'Menu', exact: true}).click();
  await mobile.screenshot({path: '.impeccable/review/menu-mobile.png', fullPage: true});
  await mobile.locator('#workspace-nav').getByRole('button', {name: 'Settings', exact: true}).click();
  await parkDock();
  await mobile.screenshot({path: '.impeccable/review/settings-mobile.png', fullPage: true});
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    'Mobile page must not overflow',
  );
  await page.route('**/api/releases', route =>
    route.fulfill({
      json: {
        installed: '0.1.0',
        latest: '0.2.0',
        available: true,
        url: 'https://github.com/ssan9876/facilities/releases/tag/v0.2.0',
        updateCommand: 'sudo /opt/facilities/bin/facilities-update --latest',
      },
    }),
  );
  await page.getByRole('button', {name: 'Updates', exact: true}).click();
  await page.getByRole('button', {name: 'Check for updates', exact: true}).click();
  await page.getByText('Version 0.2.0 is available.', {exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/updates-desktop.png', fullPage: true});
  await mobile.route('**/api/releases', route =>
    route.fulfill({
      json: {
        installed: '0.1.0',
        latest: '0.2.0',
        available: true,
        url: 'https://github.com/ssan9876/facilities/releases/tag/v0.2.0',
        updateCommand: 'sudo /opt/facilities/bin/facilities-update --latest',
      },
    }),
  );
  await mobile.getByRole('button', {name: 'Updates', exact: true}).click();
  await mobile.getByRole('button', {name: 'Check for updates', exact: true}).click();
  await mobile.getByText('Version 0.2.0 is available.', {exact: true}).waitFor();
  await mobile.screenshot({path: '.impeccable/review/updates-mobile.png', fullPage: true});
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    'Update settings must not overflow',
  );
  await page.getByRole('button', {name: 'Identity', exact: true}).click();
  await page.getByLabel('Workspace name', {exact: true}).fill('Campus Operations');
  await page.getByLabel('Welcome message').fill('Welcome to your campus.');
  await page.getByLabel('Workspace icon').selectOption('calendar');
  await page.getByRole('button', {name: 'Save changes', exact: true}).click();
  await page.getByText('Administration settings saved.', {exact: true}).waitFor();
  assert.equal(await page.title(), 'Facilities', 'the tab always reads Facilities');
  await page.screenshot({path: '.impeccable/review/identity-desktop.png', fullPage: true});
  // Administration loads on its own; people and groups are ledgers edited in sheets.
  await page.getByRole('button', {name: 'Groups', exact: true}).click();
  await page.locator('[data-new-group]').click();
  await page.locator('#group-create').getByLabel('Group name').fill('Facilities team');
  await page.locator('#group-create').getByLabel('Add newly provisioned users automatically').check();
  await page.locator('#group-create').getByRole('button', {name: 'Create group'}).click();
  await page.getByRole('cell', {name: 'Facilities team', exact: true}).waitFor();
  await page.getByRole('button', {name: 'People', exact: true}).click();
  await page.locator('[data-provision]').click();
  await page.locator('#user-create').getByLabel('Immutable SSO subject').fill('browser-user-id');
  await page.locator('#user-create').getByLabel('Display name').fill('Browser Member');
  await page.locator('#user-create').getByRole('button', {name: 'Provision person'}).click();
  await page.locator('#people-table').getByText('Browser Member', {exact: true}).waitFor();
  await page.getByLabel('Search people').fill('browser');
  assert.equal(await page.locator('#people-table tbody tr').count(), 1, 'people search filters the ledger');
  await page.getByLabel('Search people').fill('');
  await page.screenshot({path: '.impeccable/review/people-desktop.png', fullPage: true});
  await page.getByRole('button', {name: 'Edit Browser Member', exact: true}).click();
  await page.locator('#person-form').getByLabel('Role').selectOption('technician');
  await page.locator('#person-form').getByRole('button', {name: 'Save changes'}).click();
  await page.locator('#editor').waitFor({state: 'hidden'});
  await page.getByRole('button', {name: 'Groups', exact: true}).click();
  await page.getByRole('button', {name: 'Edit Facilities team', exact: true}).click();
  await page.getByText('Members · Changes save immediately', {exact: true}).waitFor();
  assert.equal(await page.locator('#member-list').getByLabel('Browser Member', {exact: true}).isChecked(), true);
  await page.locator('#member-list').getByLabel('Alex Morgan', {exact: true}).check();
  await page.getByText('Group membership saved.', {exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/groups-desktop.png', fullPage: true});
  await page.getByRole('button', {name: 'Close dialog'}).click();
  // Roles: take inventory away from technicians, then restore the defaults.
  await page.getByRole('button', {name: 'Roles', exact: true}).click();
  await page.getByLabel('Technician: See inventory', {exact: true}).uncheck();
  await page.getByRole('button', {name: 'Save roles', exact: true}).click();
  await page.getByText('1 role updated.', {exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/roles-desktop.png', fullPage: true});
  await page.getByRole('button', {name: 'Reset to defaults', exact: true}).click();
  await page.getByRole('button', {name: 'Reset?', exact: true}).click();
  await page.getByText('Role reset to the defaults in permissions.js.', {exact: true}).waitFor();
  assert.equal(await page.getByLabel('Technician: See inventory', {exact: true}).isChecked(), true);
  // Scope: a role's request permissions can be limited to request types and buildings.
  await page.locator('[data-scope-role="technician"]').click();
  await page.locator('#scope-form').getByLabel('North Campus', {exact: true}).check();
  await page.screenshot({path: '.impeccable/review/role-scope-desktop.png'});
  await page.locator('#scope-form').getByRole('button', {name: 'Save scope'}).click();
  await page.getByText('Scope for Technician saved.', {exact: true}).waitFor();
  await page.getByText('Applies: North Campus', {exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/roles-desktop.png', fullPage: true});
  await page.locator('[data-scope-role="technician"]').click();
  await page.locator('#scope-form').getByLabel('North Campus', {exact: true}).uncheck();
  await page.locator('#scope-form').getByRole('button', {name: 'Save scope'}).click();
  await page.getByText('Scope for Technician saved.', {exact: true}).waitFor();
  // Groups grant roles and can follow SSO group claims.
  await page.getByRole('button', {name: 'Groups', exact: true}).click();
  await page.locator('[data-new-group]').click();
  await page.locator('#group-create').getByLabel('Group name').fill('Plumbers');
  await page.locator('#group-create').getByLabel('Technician', {exact: true}).check();
  await page.locator('#group-create').getByLabel('SSO group claims (one per line)').fill('facilities-plumbers');
  await page.locator('#group-create').getByRole('button', {name: 'Create group'}).click();
  await page.getByRole('cell', {name: 'Technician', exact: true}).waitFor();
  await page.getByText('SSO: facilities-plumbers', {exact: true}).waitFor();
  // Auto-assignment rules.
  await page.getByRole('button', {name: 'Auto-assignment', exact: true}).click();
  await page.locator('[data-new-rule]').click();
  await page.locator('#rule-form').getByLabel('Rule name').fill('Community Center plumbing');
  await page.locator('#rule-form').getByLabel('Community Center', {exact: true}).check();
  await page.locator('#rule-form').getByLabel('Who').selectOption({label: 'Plumbers'});
  await page.screenshot({path: '.impeccable/review/assignment-rule-desktop.png'});
  await page.locator('#rule-form').getByRole('button', {name: 'Create rule'}).click();
  await page.getByRole('cell', {name: 'Community Center plumbing', exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/assignment-desktop.png', fullPage: true});
  // Checklist templates, shared replies and due dates.
  await page.getByRole('button', {name: 'Checklists & replies', exact: true}).click();
  await page.locator('[data-new-template]').click();
  await page.locator('#template-form').getByLabel('Template name').fill('Filter change');
  await page.locator('#template-form').getByLabel('Steps (one per line)').fill('Power off\nReplace filter\nPower on');
  await page.locator('#template-form').getByRole('button', {name: 'Create template'}).click();
  await page.getByRole('cell', {name: 'Filter change', exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/checklists-desktop.png', fullPage: true});
  await page.getByRole('button', {name: 'Due dates', exact: true}).click();
  await page.locator('#sla-form').getByLabel('Urgent (days)').fill('0');
  await page.locator('#sla-form').getByRole('button', {name: 'Save due dates'}).click();
  await page.getByText('Due dates saved.', {exact: true}).waitFor();
  // Access as code: edit the document in Settings, check it, apply it.
  await page.getByRole('button', {name: 'Access as code', exact: true}).click();
  await page.locator('#access-editor').waitFor();
  await page.getByRole('button', {name: 'Start from template', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('#access-editor').value.includes('it-admin'));
  await page.getByRole('button', {name: 'Check', exact: true}).click();
  await page.locator('.check-result.ok').waitFor();
  // A typo is caught before anything changes.
  await page
    .locator('#access-editor')
    .fill('version: 1\nroles:\n  oops:\n    name: Oops\n    capabilities: [requests.fly]\n');
  await page.getByRole('button', {name: 'Apply', exact: true}).click();
  await page.locator('.check-result.bad').waitFor();
  assert.match(await page.locator('.check-result').innerText(), /requests\.fly/);
  await page.screenshot({path: '.impeccable/review/access-problems-desktop.png', fullPage: true});
  await page
    .locator('#access-editor')
    .fill(
      'version: 1\nroles:\n  night-crew:\n    name: Night crew\n    extends: technician\n    scope: {buildings: [North Campus]}\n',
    );

  await page.getByText('Unsaved changes', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Check', exact: true}).click();
  await page.locator('.check-result.ok').waitFor();
  await page.getByRole('button', {name: 'Apply', exact: true}).click();
  await page.getByText('Access document applied.', {exact: true}).waitFor();
  await page.locator('.version-list li').first().waitFor();
  assert.equal(await page.getByText('Unsaved changes', {exact: true}).count(), 0);
  await page.screenshot({path: '.impeccable/review/access-desktop.png', fullPage: true});
  await page.getByRole('button', {name: 'Roles', exact: true}).click();
  await page.locator('.role-col').filter({hasText: 'Night crew'}).getByText('Access file', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Provisioning', exact: true}).click();
  await page.getByLabel('Connection name').fill('Browser integration');
  await page.getByRole('button', {name: 'Create token', exact: true}).click();
  await page.getByText('Copy this token now. It is shown once.', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'I saved the token'}).click();
  await page.getByRole('button', {name: 'Revoke', exact: true}).click();
  await page.getByText('Revoked', {exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/provisioning-desktop.png', fullPage: true});
  await mobile.reload();
  await mobile.getByRole('button', {name: 'Menu', exact: true}).click();
  await mobile.locator('#workspace-nav').getByRole('button', {name: 'Settings', exact: true}).click();
  await mobile.getByRole('button', {name: 'Groups', exact: true}).click();
  await mobile.locator('[data-edit-group]').first().waitFor();
  await mobile.screenshot({path: '.impeccable/review/groups-mobile.png', fullPage: true});
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    'Groups must fit on mobile',
  );
  await mobile.getByRole('button', {name: 'Identity', exact: true}).click();
  await mobile.screenshot({path: '.impeccable/review/identity-mobile.png', fullPage: true});
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    'Identity settings must fit on mobile',
  );
  // Record lifecycle: edit a building in place.
  await page.locator('#workspace-nav').getByRole('button', {name: 'Buildings', exact: true}).click();
  await page.getByRole('button', {name: 'Edit North Campus', exact: true}).click();
  await page.getByLabel('Building name').fill('North Campus East');
  await page.getByRole('button', {name: 'Save changes', exact: true}).click();
  await page.getByText('North Campus East', {exact: true}).first().waitFor();
  await page.screenshot({path: '.impeccable/review/buildings-desktop.png', fullPage: true});
  // Space reservations refuse overlapping bookings.
  const reserve = async title => {
    await page.locator('#workspace-nav').getByRole('button', {name: 'Schedule requests', exact: true}).click();
    await page.getByRole('button', {name: 'New schedule request', exact: true}).click();
    await page.getByLabel('What do you need?').fill(title);
    await page.locator('[name=building_id]').selectOption('b2');
    await page.getByLabel('Starts').fill('2026-11-02T09:00');
    await page.getByLabel('Ends').fill('2026-11-02T10:00');
    await page.getByLabel('Space (optional)').selectOption('s2');
    await page.getByRole('button', {name: 'Create request', exact: true}).click();
  };
  await reserve('Budget workshop');
  await page.locator('#editor').waitFor({state: 'hidden'});
  await reserve('Overlapping workshop');
  await page.getByText('Conference room A is already reserved', {exact: false}).waitFor();
  await page.screenshot({path: '.impeccable/review/reservation-conflict.png', fullPage: true});
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  // Request details: edit, attach a photo, record a part and read the activity history.
  await page.locator('#workspace-nav').getByRole('button', {name: 'All requests', exact: true}).click();
  await page.locator('.order-title').filter({hasText: orderTitle}).click();
  await page.getByRole('button', {name: 'Edit details', exact: true}).click();
  await page.getByLabel('Title').fill(orderTitle + ' (edited)');
  await page.getByRole('button', {name: 'Save details', exact: true}).click();
  await page.getByRole('heading', {name: orderTitle + ' (edited)', exact: true}).waitFor();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.locator('#attach-input').setInputFiles({name: 'leak-photo.png', mimeType: 'image/png', buffer: png});
  await page.getByRole('link', {name: 'leak-photo.png', exact: true}).waitFor();
  await page.locator('#part-form [name=part_id]').selectOption('p1');
  await page.locator('#part-form [name=quantity]').fill('2');
  await page.getByRole('button', {name: 'Record part', exact: true}).click();
  await page.getByText('2 × HVAC return filter 20×25×1', {exact: false}).waitFor();
  await page.getByRole('button', {name: 'Activity', exact: true}).click();
  await page.locator('.history-list').getByText('Attached leak-photo.png', {exact: false}).waitFor();
  await page.screenshot({path: '.impeccable/review/order-detail-desktop.png', fullPage: true});
  await page.getByRole('button', {name: 'Back', exact: true}).click();
  await page
    .getByRole('button', {name: /^Notifications/})
    .first()
    .waitFor();
  await page.locator('#bell').click();
  await page.locator('#notif-pop').waitFor();
  await page.screenshot({path: '.impeccable/review/notifications-dropdown.png'});
  await page.keyboard.press('Escape');
  await page.locator('#notif-pop').waitFor({state: 'detached'});
  // Inventory, reports and audit pages.
  await page.locator('#workspace-nav').getByRole('button', {name: 'Inventory', exact: true}).click();
  await page.getByText('12', {exact: true}).first().waitFor();
  await page.getByText('Low stock', {exact: true}).first().waitFor();
  await page.screenshot({path: '.impeccable/review/inventory-desktop.png', fullPage: true});
  await page.locator('#workspace-nav').getByRole('button', {name: 'Reports', exact: true}).click();
  await page.getByText('Average time to complete', {exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/reports-desktop.png', fullPage: true});
  await page.locator('#workspace-nav').getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('button', {name: 'Audit log', exact: true}).click();
  await page.locator('.audit-list').getByText('Updated building North Campus East', {exact: false}).waitFor();
  await page.screenshot({path: '.impeccable/review/audit-desktop.png', fullPage: true});
  for (const name of ['Inventory', 'Reports']) {
    await mobile.getByRole('button', {name: 'Menu', exact: true}).click();
    await mobile.locator('#workspace-nav').getByRole('button', {name, exact: true}).click();
    await mobile.waitForTimeout(300);
    await mobile.screenshot({path: `.impeccable/review/${name.toLowerCase()}-mobile.png`, fullPage: true});
    assert.equal(
      await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `${name} must fit on mobile`,
    );
  }
  await page.goto(base + '/report?building=b2&asset=a3');
  await page.locator('#create-form').waitFor();
  assert.equal(await page.locator('#create-form [name=building_id]').inputValue(), 'b2');
  assert.equal(await page.locator('#create-form [name=asset_id]').inputValue(), 'a3');
  assert.equal(new URL(page.url()).pathname, '/', 'the report link is consumed');
  await page.screenshot({path: '.impeccable/review/report-link-desktop.png'});
  await page.getByRole('button', {name: 'Close dialog'}).click();
  const labels = await browser.newPage({viewport: {width: 1000, height: 900}});
  await labels.context().addCookies(await page.context().cookies());
  await labels.goto(base + '/labels?building=b2');
  await labels.getByRole('button', {name: 'Print labels'}).waitFor();
  assert.ok((await labels.locator('.label').count()) >= 2);
  await labels.screenshot({path: '.impeccable/review/labels.png', fullPage: true});
  await labels.close();
  // Requester view: report on the page, then follow the ticket.
  await db.query("UPDATE users SET role='requester' WHERE id='demo-admin'");
  await page.reload();
  await page.getByRole('heading', {name: 'Your requests', exact: true}).waitFor();
  assert.equal(await page.locator('#workspace-nav').getByRole('button', {name: 'Buildings', exact: true}).count(), 0);
  await page.locator('#quick-form').getByLabel('What needs attention?').fill('Flickering light in room 12');
  await page.locator('#quick-form [name=building_id]').selectOption('b1');
  await page.locator('#quick-form').getByRole('button', {name: 'Submit request'}).click();
  await page.getByText('Request submitted. You will be notified as it moves forward.', {exact: true}).waitFor();
  await page.locator('.order-title').filter({hasText: 'Flickering light in room 12'}).waitFor();
  await page.screenshot({path: '.impeccable/review/requester-desktop.png', fullPage: true});
  await db.query("UPDATE users SET role='admin' WHERE id='demo-admin'");
  // Request forms: a required category and a dropdown question shape new tickets.
  await page.reload();
  await page.getByRole('heading', {name: 'Today', exact: true}).waitFor();
  await page.locator('#workspace-nav').getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('button', {name: 'Request forms', exact: true}).click();
  await page.locator('#rules-form').waitFor();
  await page.locator('[data-new-category]').click();
  await page.locator('#category-form').getByLabel('Category name').fill('Plumbing');
  await page.locator('#category-form').getByRole('button', {name: 'Add category'}).click();
  await page.getByRole('cell', {name: 'Plumbing', exact: true}).waitFor();
  await page.locator('[data-new-field]').click();
  await page.locator('#field-form').getByLabel('Question', {exact: true}).fill('Floor');
  await page.locator('#field-form [name=kind]').selectOption('select');
  await page.locator('#field-form [name=options]').fill('Ground\nFirst\nSecond');
  await page.locator('#field-form').getByLabel('People must answer this question').check();
  await page.locator('#field-form').getByRole('button', {name: 'Add question'}).click();
  await page.getByRole('cell', {name: 'Floor', exact: true}).waitFor();
  await page.locator('#rules-form [name=category]').selectOption('required');
  await page.getByRole('button', {name: 'Save form rules', exact: true}).click();
  await page.getByText('Form rules saved.', {exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/request-forms-desktop.png', fullPage: true});
  await page.locator('#workspace-nav').getByRole('button', {name: 'Overview', exact: true}).click();
  await page.getByRole('button', {name: 'New request', exact: true}).click();
  await page.locator('#create-form').getByLabel('What do you need?').fill('Dripping tap in staff room');
  await page.locator('#create-form [name=building_id]').selectOption('b1');
  await page.locator('#create-form [name=category_id]').selectOption({label: 'Plumbing'});
  await page.locator('#create-form').getByLabel('Floor').selectOption('First');
  await page.locator('#editor').evaluate(el => el.getAnimations().forEach(a => a.finish()));
  await page.screenshot({path: '.impeccable/review/new-request-form.png'});
  await page.getByRole('button', {name: 'Create request', exact: true}).click();
  await page.locator('#editor').waitFor({state: 'hidden'});
  await page.locator('.order-title').filter({hasText: 'Dripping tap in staff room'}).click();
  await page.locator('#ticket-page').getByText('Plumbing', {exact: true}).waitFor();
  await page.locator('#ticket-page').getByText('First', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Back', exact: true}).click();
  // Filters narrow a large register and show what is applied.
  await page.locator('#workspace-nav').getByRole('button', {name: 'All requests', exact: true}).click();
  await page.locator('[data-filters-toggle]').click();
  await page.locator('[data-adv=category]').selectOption({label: 'Maintenance · Plumbing'});
  await page.getByRole('button', {name: /^Remove filter Category/}).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('#order-table tbody tr').length === 1);
  await page.locator('[data-adv=sort]').selectOption('priority');
  await page.screenshot({path: '.impeccable/review/filters-desktop.png', fullPage: true});
  await page.getByRole('button', {name: 'Clear all', exact: true}).click();
  await page.waitForFunction(() => document.querySelectorAll('#order-table tbody tr').length > 1);
  // Calendar: tickets on their due days.
  await page.locator('#workspace-nav').getByRole('button', {name: 'Calendar', exact: true}).click();
  await page.locator('.cal-grid .cal-chip').first().waitFor();
  await page.screenshot({path: '.impeccable/review/calendar-desktop.png', fullPage: true});
  await page.getByRole('button', {name: 'Agenda', exact: true}).click();
  await page.locator('.agenda').waitFor();
  await page.getByRole('button', {name: 'Month', exact: true}).click();
  await page.locator('.cal-grid').waitFor();
  await page.locator('.cal-grid .cal-chip').filter({hasText: 'Dripping tap'}).click();
  await page.getByRole('heading', {name: 'Dripping tap in staff room', exact: true}).waitFor();
  await page.getByRole('button', {name: 'Back', exact: true}).click();
  // Backups and retention.
  await page.locator('#workspace-nav').getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('button', {name: 'Backups & data', exact: true}).click();
  await page.getByText('sudo /opt/facilities/bin/facilities-update --install-agent', {exact: true}).waitFor();
  await page.locator('#retention-form').getByLabel('Notifications (days)').fill('90');
  await page.getByRole('button', {name: 'Save retention', exact: true}).click();
  await page.getByText('Retention saved.', {exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/backups-desktop.png', fullPage: true});
  await mobile.reload();
  await mobile.getByRole('button', {name: 'Menu', exact: true}).click();
  await mobile.locator('#workspace-nav').getByRole('button', {name: 'Calendar', exact: true}).click();
  await mobile.locator('.agenda').waitFor();
  await parkDock();
  await mobile.screenshot({path: '.impeccable/review/calendar-mobile.png', fullPage: true});
  await mobile.locator('.agenda .cal-chip').first().click();
  await mobile.locator('#ticket-page .tp-head').waitFor();
  await mobile.screenshot({path: '.impeccable/review/ticket-mobile.png'});
  await parkDock();
  await mobile.screenshot({path: '.impeccable/review/ticket-mobile-full.png', fullPage: true});
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    'Calendar must fit on mobile',
  );
  // Asset history from the Assets list, a scanned label, and work done offline.
  await page.locator('#workspace-nav').getByRole('button', {name: 'Assets', exact: true}).click();
  await page.locator('[data-open-asset="a2"]').click();
  await page.getByRole('heading', {name: 'Main circulation pump', exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/asset-desktop.png', fullPage: true});
  const QR = require('qrcode');
  const label = await QR.toBuffer(base + '/report?building=b1&asset=a1', {width: 360, margin: 2});
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('scan');
  await page.keyboard.press('Enter');
  await page.locator('#scan-status').waitFor();
  await page.locator('#scan-photo').setInputFiles({name: 'label.png', mimeType: 'image/png', buffer: label});
  await page.getByRole('heading', {name: 'Rooftop HVAC · Unit 04', exact: true}).waitFor();
  await page.getByRole('button', {name: 'Report a problem', exact: true}).click();
  assert.equal(await page.locator('#create-form [name=asset_id]').inputValue(), 'a1', 'the report starts at the asset');
  await page.getByRole('button', {name: 'Close dialog'}).click();
  await page.goto(base + '/tickets/WO-0002');
  await page.locator('#comment-form').waitFor();
  await page.waitForFunction(() => navigator.serviceWorker?.controller || true);
  await page.context().setOffline(true);
  await page.getByLabel('Add a comment').fill('Written in the basement');
  await page.getByRole('button', {name: 'Post comment', exact: true}).click();
  await page
    .locator('#offline-bar')
    .getByText(/offline/)
    .waitFor();
  await page.screenshot({path: '.impeccable/review/offline-desktop.png'});
  await page.context().setOffline(false);
  await page.getByText(/1 offline change sent\./).waitFor({timeout: 15000});
  await page.getByText('Written in the basement', {exact: true}).waitFor();
  // Live updates: a ticket created in one browser appears in another without reloading.
  await mobile.goto(base);
  await mobile.getByRole('button', {name: 'Menu', exact: true}).click();
  await mobile.locator('#workspace-nav').getByRole('button', {name: 'All requests', exact: true}).click();
  await mobile.locator('.order-title').first().waitFor();
  await mobile.waitForTimeout(800); // the stream connects right after the first render
  const liveTitle = 'Streamed ' + Date.now();
  const created = await page.evaluate(
    async title =>
      (
        await fetch('/api/orders', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'x-csrf-token': (await (await fetch('/api/me')).json()).csrf},
          body: JSON.stringify({
            title,
            request_type: 'technology',
            building_id: 'b1',
            due_date: new Date().toISOString().slice(0, 10),
          }),
        })
      ).status,
    liveTitle,
  );
  assert.equal(created, 201);
  await mobile.getByText(liveTitle, {exact: true}).waitFor({timeout: 5000});
  assert.deepEqual(errors, [], 'Browser console must not contain JavaScript errors');
  console.log(
    'Browser checks passed: create, complete, comment, edit, reservations, attachments, parts, inventory, reports, audit, navigation, desktop and mobile.',
  );
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await db.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
