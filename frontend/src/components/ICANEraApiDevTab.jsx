import React, { useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '../lib/supabase/client';

/**
 * API tab of the ICAN developer panel: approve outside developers, watch usage, switch endpoints off.
 *
 * The console itself is one framework-free module shared by all four developer panels
 * (frontend/public/developers/admin.js). It renders in a Shadow DOM so this app's global button/input
 * styling cannot touch it, and it asks for a REAL signed-in admin account: the panel's own PIN ships in
 * the public JavaScript and is never used here. Database side: supabase/migrations/20261005100000_era_api.sql.
 */
export default function ICANEraApiDevTab() {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let ui = null;
    let off = false;
    (async () => {
      try {
        const url = '/developers/admin.js';
        const { mountEraApiAdmin } = await import(/* @vite-ignore */ url);
        const sb = getSupabaseClient();
        if (off || !ref.current || !sb) { if (!sb) setFailed(true); return; }
        ui = mountEraApiAdmin(ref.current, {
          rpc: (fn, args) => sb.rpc(fn, args),
          signIn: (email, password) => sb.auth.signInWithPassword({ email, password }),
        });
      } catch {
        if (!off) setFailed(true);
      }
    })();
    return () => { off = true; if (ui) ui.destroy(); };
  }, []);

  if (failed) {
    return (
      <div className="rounded-2xl border p-8 text-center text-xs" style={{ background: 'var(--dp-card)', borderColor: 'var(--dp-card-bd)', color: 'var(--dp-muted)' }}>
        The API console could not load. Check your connection and refresh.
      </div>
    );
  }
  return <div ref={ref} />;
}
