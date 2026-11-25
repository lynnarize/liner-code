/*
  Which keys a menu takes for itself (ui.tsx Pop and SubMenu, board Menus): ↑ ↓ Home End move between its rows, and ←
  takes a side menu back to its row. A text field in a menu (Dismiss › Other's note, the pull request picker's find
  field, a project chooser's find field) keeps those keys for its caret, so the menu leaves them alone there; Escape
  still closes it. Apart from React so plain Node can test it (engine/test/code-face-fixes.test.ts).
*/

const ROW_KEYS = ["ArrowDown", "ArrowUp", "Home", "End"];

/** A field that takes typing: a switch or a tick box is not one, and keeps the menu's keys. */
const TEXT = "input:not([type='checkbox']):not([type='radio']):not([type='range']), textarea, [contenteditable]:not([contenteditable='false'])";

/** Whether the key was pressed in a text field: an input, a textarea, or something editable. */
export const inText = (target: { closest?: (selector: string) => unknown } | null) => Boolean(target?.closest?.(TEXT));

/** Whether the menu moves between its rows for this key. */
export const movesRows = (key: string, typing: boolean) => !typing && ROW_KEYS.includes(key);

/** Whether a side menu goes back to the row it opened from for this key. */
export const backFromSide = (key: string, typing: boolean) => key === "Escape" || (key === "ArrowLeft" && !typing);

/** What a side menu focuses as it opens: its text field when it has one (the chooser's find field), else its first row. A switch is not a text field. */
export const FIRST_FOCUS = "input:not([type='checkbox']):not([type='radio']):not([type='range']):not(:disabled), textarea:not(:disabled), [data-autofocus]";
