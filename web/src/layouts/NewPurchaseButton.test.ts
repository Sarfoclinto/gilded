import { describe, expect, it } from 'vitest';
import { isTyping } from './NewPurchaseButton';

const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as EventTarget;

describe('the N shortcut stays out of the way of typing', () => {
  it('is typing in fields and nowhere else', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) expect(isTyping(el(tag))).toBe(true);
    expect(isTyping(el('DIV', true))).toBe(true);
    expect(isTyping(el('BUTTON'))).toBe(false);
    expect(isTyping(el('DIV'))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});