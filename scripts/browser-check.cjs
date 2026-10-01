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
  await page.locator('.order-title').filter({hasText: orderTitle}).click();
  await page.locator('[name=status]').selectOption('Completed');
  await page.getByRole('button', {name: 'Save changes', exact: true}).click();
  await page.locator('#editor').waitFor({state: 'hidden'});
  await page.locator('nav').getByRole('button', {name: 'All requests', exact: true}).click();
  await page.locator('.order-title').filter({hasText: orderTitle}).click();
  await page.getByLabel('Add a comment').fill('Browser verification completed.');
  await page.getByRole('button', {name: 'Post comment', exact: true}).click();
  await page.getByText('Browser verification completed.', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Close dialog'}).click();
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
  assert.equal(await page.locator('nav').getByRole('button', {name: 'Technology requests', exact: true}).count(), 0);
  await page.getByRole('button', {name: 'Overview', exact: true}).click();
  await page.getByRole('button', {name: 'New request', exact: true}).click();
  assert.equal(await page.locator('[name=request_type] option[value=technology]').count(), 0);
  await page.getByRole('button', {name: 'Close dialog'}).click();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('switch', {name: 'Technology requests', exact: true}).check();
  await page.getByRole('button', {name: 'Save settings', exact: true}).click();
  await page.getByText('Workspace settings saved.', {exact: true}).waitFor();
  await page.locator('nav').getByRole('button', {name: 'Notifications', exact: true}).click();
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
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  for (const name of ['Maintenance requests', 'Schedule requests', 'Technology requests'])
    await page.getByRole('switch', {name, exact: true}).uncheck();
  await page.getByRole('button', {name: 'Save settings', exact: true}).click();
  await page.locator('nav').getByRole('button', {name: 'All requests', exact: true}).waitFor({state: 'hidden'});
  await page.getByRole('button', {name: 'Overview', exact: true}).click();
  await page.getByText('Request types are disabled. Your existing records are preserved.', {exact: false}).waitFor();
  await page.screenshot({path: '.impeccable/review/disabled-desktop.png', fullPage: true});
  await page.getByRole('button', {name: 'Configure request types', exact: true}).click();
  await page.getByRole('heading', {name: 'Workspace settings', exact: true}).waitFor();
  for (const name of ['Maintenance requests', 'Schedule requests', 'Technology requests'])
    await page.getByRole('switch', {name, exact: true}).check();
  await page.getByRole('button', {name: 'Save settings', exact: true}).click();
  await page.locator('nav').getByRole('button', {name: 'Technology requests', exact: true}).waitFor();
  const mobile = await browser.newPage({viewport: {width: 390, height: 844}});
  await mobile.goto(base);
  await mobile.getByRole('link', {name: 'Enter demo workspace'}).click();
  await mobile.getByRole('heading', {name: 'Today', exact: true}).waitFor();
  await mobile.screenshot({path: '.impeccable/review/mobile.png', fullPage: true});
  await mobile.getByRole('button', {name: 'Menu', exact: true}).click();
  await mobile.screenshot({path: '.impeccable/review/menu-mobile.png', fullPage: true});
  await mobile.locator('nav').getByRole('button', {name: 'Settings', exact: true}).click();
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
        url: 'https://github.com/ssan9876/go-fmx-clone/releases/tag/v0.2.0',
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
        url: 'https://github.com/ssan9876/go-fmx-clone/releases/tag/v0.2.0',
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
  assert.equal(await page.title(), 'Campus Operations · Work order pad');
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
  await mobile.locator('nav').getByRole('button', {name: 'Settings', exact: true}).click();
  await mobile.getByRole('button', {name: 'Groups', exact: true}).click();
  await mobile.locator('[data-edit-group]').waitFor();
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
  await page.locator('nav').getByRole('button', {name: 'Buildings', exact: true}).click();
  await page.getByRole('button', {name: 'Edit North Campus', exact: true}).click();
  await page.getByLabel('Building name').fill('North Campus East');
  await page.getByRole('button', {name: 'Save changes', exact: true}).click();
  await page.getByText('North Campus East', {exact: true}).first().waitFor();
  await page.screenshot({path: '.impeccable/review/buildings-desktop.png', fullPage: true});
  // Space reservations refuse overlapping bookings.
  const reserve = async title => {
    await page.locator('nav').getByRole('button', {name: 'Schedule requests', exact: true}).click();
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
  await page.locator('nav').getByRole('button', {name: 'All requests', exact: true}).click();
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
  await page.getByRole('button', {name: 'Close dialog'}).click();
  // Inventory, reports and audit pages.
  await page.locator('nav').getByRole('button', {name: 'Inventory', exact: true}).click();
  await page.getByText('12', {exact: true}).first().waitFor();
  await page.getByText('Low stock', {exact: true}).first().waitFor();
  await page.screenshot({path: '.impeccable/review/inventory-desktop.png', fullPage: true});
  await page.locator('nav').getByRole('button', {name: 'Reports', exact: true}).click();
  await page.getByText('Average time to complete', {exact: true}).waitFor();
  await page.screenshot({path: '.impeccable/review/reports-desktop.png', fullPage: true});
  await page.locator('nav').getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('button', {name: 'Audit log', exact: true}).click();
  await page.locator('.audit-list').getByText('Updated building North Campus East', {exact: false}).waitFor();
  await page.screenshot({path: '.impeccable/review/audit-desktop.png', fullPage: true});
  for (const name of ['Inventory', 'Reports']) {
    await mobile.getByRole('button', {name: 'Menu', exact: true}).click();
    await mobile.locator('nav').getByRole('button', {name, exact: true}).click();
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
  assert.equal(await page.locator('nav').getByRole('button', {name: 'Buildings', exact: true}).count(), 0);
  await page.locator('#quick-form').getByLabel('What needs attention?').fill('Flickering light in room 12');
  await page.locator('#quick-form [name=building_id]').selectOption('b1');
  await page.locator('#quick-form').getByRole('button', {name: 'Submit request'}).click();
  await page.getByText('Request submitted. You will be notified as it moves forward.', {exact: true}).waitFor();
  await page.locator('.order-title').filter({hasText: 'Flickering light in room 12'}).waitFor();
  await page.screenshot({path: '.impeccable/review/requester-desktop.png', fullPage: true});
  await db.query("UPDATE users SET role='admin' WHERE id='demo-admin'");
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
