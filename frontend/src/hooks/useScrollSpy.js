import { useEffect, useState } from 'react';

// Which section of a long page the visitor is on: the id of the last section
// whose top has scrolled past `line` (a fraction of the viewport height), or
// the last one once they reach the bottom of the page. Drives the active tile
// of the phone bottom navigation on the public pages.
//
// ids: section element ids in page order. enabled=false pauses all listeners
// (e.g. on desktop, where the bottom bar isn't shown).
export default function useScrollSpy(ids, { line = 0.4, enabled = true } = {}) {
  const [active, setActive] = useState(ids[0]);
  const key = ids.join('|');

  useEffect(() => {
    if (!enabled) return undefined;
    const list = key.split('|');
    let frame = 0;

    const compute = () => {
      frame = 0;
      const y = window.innerHeight * line;
      let current = list[0];
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= y) current = id;
      }
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom && window.scrollY > 0) current = list[list.length - 1];
      setActive((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(compute); };

    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [key, line, enabled]);

  return active;
}
