// When a phone keyboard opens it covers the lower half of a bottom-sheet card; scroll the field the
// person just tapped into the middle of the visible area. Attach as onFocus on the scrolling body
// (React's onFocus bubbles, so one handler covers every input inside).
export const scrollFocusedIntoView = (event) => {
  const el = event?.target;
  if (!el || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || typeof el.scrollIntoView !== 'function') return;
  // wait for the keyboard animation to settle before measuring
  setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* old browser */ } }, 300);
};
