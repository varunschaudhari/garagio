import { html, attrs, $$, $ } from '../dom.js';
import { t, fieldError } from '../i18n.js';

let uid = 0;

/**
 * Form field markup.
 * opts: name, label, type (text|number|select|textarea|switch|check|password|date|datetime-local|tel|email),
 *       value, required, options [{value,label}], placeholder, hint, span2, dtype (num|int|bool|str),
 *       step, min, max, inputmode, readonly, disabled, autocomplete, rows, cls
 */
export function field(o) {
  const id = 'f' + ++uid + '-' + o.name;
  const type = o.type || 'text';
  const dtype = o.dtype || (type === 'number' ? 'num' : type === 'switch' || type === 'check' ? 'bool' : 'str');
  const common = {
    id,
    name: o.name,
    'data-type': dtype,
    required: !!o.required,
    placeholder: o.placeholder,
    readonly: !!o.readonly,
    disabled: !!o.disabled,
    autocomplete: o.autocomplete || 'off',
    inputmode: o.inputmode || (dtype === 'num' ? 'decimal' : dtype === 'int' ? 'numeric' : undefined),
  };
  const label = html`<label for="${id}">${o.label}${o.required ? html`<span class="req" aria-hidden="true">*</span>` : ''}</label>`;
  const hint = o.hint ? html`<div class="hint">${o.hint}</div>` : '';
  const err = html`<div class="err" id="${id}-err"></div>`;
  const wrapCls = `field ${o.span2 ? 'span-2' : ''} ${o.cls || ''}`;

  if (type === 'switch' || type === 'check') {
    const checked = o.value === true || o.value === 1 || o.value === '1';
    const control = type === 'switch'
      ? html`<label class="switch"><input type="checkbox" ${attrs({ ...common, checked, placeholder: undefined, autocomplete: undefined, inputmode: undefined })}><span class="track"></span><span>${o.label}</span></label>`
      : html`<label class="check"><input type="checkbox" ${attrs({ ...common, checked, placeholder: undefined, autocomplete: undefined, inputmode: undefined })}><span>${o.label}</span></label>`;
    return html`<div class="${wrapCls}">${control}${hint}${err}</div>`;
  }
  if (type === 'select') {
    const v = o.value === null || o.value === undefined ? '' : String(o.value);
    return html`<div class="${wrapCls}">${label}
      <select class="select" ${attrs({ id, name: o.name, 'data-type': dtype, required: !!o.required, disabled: !!o.disabled })}>
        ${o.options.map((op) => html`<option value="${op.value ?? ''}" ${String(op.value ?? '') === v ? 'selected' : ''}>${op.label}</option>`)}
      </select>${hint}${err}</div>`;
  }
  if (type === 'textarea') {
    return html`<div class="${wrapCls}">${label}<textarea class="input" rows="${o.rows || 3}" ${attrs(common)}>${o.value ?? ''}</textarea>${hint}${err}</div>`;
  }
  const inputType = type === 'number' ? 'text' : type;
  return html`<div class="${wrapCls}">${label}
    <input class="input ${dtype === 'num' || dtype === 'int' ? 'num' : ''}" type="${inputType}" ${attrs({ ...common, value: o.value ?? '', step: o.step, min: o.min, max: o.max })}>
    ${hint}${err}</div>`;
}

/** Read named controls into an object, converting by data-type. Empty → '' (API treats as null). */
export function readForm(form) {
  const out = {};
  for (const c of $$('[name]', form)) {
    if (c.disabled) continue;
    const dt = c.dataset.type || 'str';
    if (c.type === 'checkbox') {
      out[c.name] = c.checked;
      continue;
    }
    if (c.type === 'radio') {
      if (c.checked) out[c.name] = c.value;
      continue;
    }
    const v = (c.value ?? '').trim();
    if (dt === 'num' || dt === 'int') {
      const n = v.replace(/,/g, '');
      out[c.name] = n === '' ? '' : Number(n);
      if (n !== '' && Number.isNaN(out[c.name])) out[c.name] = n; // let the API say "not a number"
    } else {
      out[c.name] = v;
    }
  }
  return out;
}

export function clearErrors(form) {
  $$('.field.invalid', form).forEach((f) => f.classList.remove('invalid'));
}

/** Mark fields from an API 422 response. Returns true when at least one was shown. */
export function showFieldErrors(form, fields) {
  clearErrors(form);
  let shown = false;
  let first = null;
  for (const [name, code] of Object.entries(fields || {})) {
    const control = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!control) continue;
    const f = control.closest('.field');
    if (!f) continue;
    f.classList.add('invalid');
    const e = $('.err', f);
    if (e) e.textContent = typeof code === 'string' ? fieldError(code) : t('fields.invalid');
    first = first || control;
    shown = true;
  }
  if (first) first.focus();
  return shown;
}

/** Client-side required check. */
export function checkRequired(form) {
  clearErrors(form);
  const errors = {};
  for (const c of $$('[required]', form)) {
    if (c.type === 'checkbox' ? !c.checked : !String(c.value || '').trim()) errors[c.name] = 'required';
  }
  if (Object.keys(errors).length) {
    showFieldErrors(form, errors);
    return false;
  }
  return true;
}

/** Disable a button and show a spinner while an async action runs. */
export async function busy(button, fn) {
  if (!button) return fn();
  const prev = button.innerHTML;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  const label = button.textContent.trim();
  button.innerHTML = `<svg class="icon spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><span>${label.replace(/[<>&]/g, '')}</span>`;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.innerHTML = prev;
  }
}
