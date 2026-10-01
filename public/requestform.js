// The configurable part of a ticket form: the category and custom questions an administrator set
// up for each request type, plus the rules that hide or require built-in fields.
import {state, escape, select} from './ui.js';

export const formFor = type => state.data.forms?.[type] || {rules: {}, categories: [], fields: []};
export const ruleFor = (type, key) => formFor(type).rules?.[key] || 'optional';

function question(f, value) {
  const name = `answer:${f.id}`;
  const label = `${escape(f.label)}${f.required ? '' : ' (optional)'}`;
  const help = f.help ? `<small class="field-help">${escape(f.help)}</small>` : '';
  const req = f.required ? 'required' : '';
  switch (f.kind) {
    case 'textarea':
      return `<label class="field full">${label}<textarea name="${name}" maxlength="5000" ${req}>${escape(value || '')}</textarea>${help}</label>`;
    case 'select':
      return `<label class="field">${label}<select name="${name}" ${req}><option value="">Choose…</option>${f.options.map(o => `<option ${o === value ? 'selected' : ''}>${escape(o)}</option>`).join('')}</select>${help}</label>`;
    case 'yesno':
      return `<label class="field">${label}<select name="${name}" ${req}><option value="">Choose…</option>${['Yes', 'No'].map(o => `<option ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select>${help}</label>`;
    case 'checkbox':
      return `<label class="field-check">${`<input type="checkbox" name="${name}" ${value ? 'checked' : ''} ${req}>`}${escape(f.label)}${f.required ? '' : ' (optional)'}${help}</label>`;
    case 'number':
      return `<label class="field">${label}<input name="${name}" type="number" step="any" value="${escape(value || '')}" ${req}>${help}</label>`;
    case 'date':
      return `<label class="field">${label}<input name="${name}" type="date" value="${escape(value || '')}" ${req}>${help}</label>`;
    default:
      return `<label class="field">${label}<input name="${name}" type="text" maxlength="500" value="${escape(value || '')}" ${req}>${help}</label>`;
  }
}

// Category select plus the questions that apply to the chosen category.
export function configurableFields(type, {category = '', answers = {}} = {}) {
  const form = formFor(type);
  const rule = ruleFor(type, 'category');
  const categories = form.categories.filter(c => !c.archived_at || c.id === category);
  const categorySelect =
    rule !== 'hidden' && categories.length
      ? select(
          `Category${rule === 'required' ? '' : ' (optional)'}`,
          'category_id',
          [['', rule === 'required' ? 'Choose category' : 'No category'], ...categories.map(c => [c.id, c.name])],
          category,
          rule === 'required',
        )
      : '';
  const questions = form.fields
    .filter(f => !f.archived_at && (!f.category_id || f.category_id === category))
    .map(f => question(f, answers[f.id]))
    .join('');
  return categorySelect + (questions ? `<div class="custom-questions">${questions}</div>` : '');
}

// Re-renders the questions when the category changes, keeping answers already typed.
export function bindConfigurable(root, type, slot) {
  const pick = root.querySelector('[name=category_id]');
  if (!pick) return;
  pick.addEventListener('change', () => {
    const answers = collectAnswers(root);
    slot.innerHTML = configurableFields(type, {category: pick.value, answers});
    bindConfigurable(root, type, slot);
  });
}
export function collectAnswers(root) {
  const answers = {};
  root.querySelectorAll('[name^="answer:"]').forEach(input => {
    answers[input.name.slice(7)] = input.type === 'checkbox' ? input.checked : input.value;
  });
  return answers;
}
// Removes answer:* keys FormData collected and attaches them as {answers}.
export function withAnswers(data, root) {
  for (const key of Object.keys(data)) if (key.startsWith('answer:')) delete data[key];
  return {...data, answers: collectAnswers(root)};
}
