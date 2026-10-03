/* Accounts and cloud saves via Supabase (Google sign-in + the `teams` table in supabase/schema.sql).
   Signed out, the site works exactly as before from browser storage. Signed in, every team edit is
   saved locally at once and upserted to Supabase about a second later. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAVE_DELAY_MS = 900;
const RETRY_MS = 5000;

window.cloud = (() => {
  const cfg = window.BADGE_RUN_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase?.createClient);
  let client = null;
  let timer = null;
  const pending = new Map(); // team id -> { team, game }

  const api = {
    enabled,
    user: null,
    status: 'idle', // idle | saving | saved | error
    statusText() {
      return { idle: 'Teams saved to your account', saving: 'Saving…', saved: 'Saved', error: 'Couldn’t save. Retrying…' }[this.status];
    },

    async start() {
      if (!enabled) return;
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
      });
      // getSession() also finishes a sign-in redirect (exchanges ?code= for a session).
      const { data: { session } } = await client.auth.getSession();
      cleanAuthParams();
      if (session?.user) await onSignedIn(session.user);
      client.auth.onAuthStateChange((event, s) => {
        if (event === 'SIGNED_IN' && s?.user && s.user.id !== api.user?.id) onSignedIn(s.user);
        else if (event === 'SIGNED_OUT' && api.user) onSignedOut();
      });
      window.addEventListener('pagehide', () => api.flush());
    },

    async signIn() {
      if (!client) return;
      const provider = cfg.provider || 'google';
      // Check the provider is switched on first; otherwise Supabase shows a raw JSON error page.
      try {
        const r = await fetch(`${cfg.supabaseUrl}/auth/v1/settings`, { headers: { apikey: cfg.supabaseKey } });
        const settings = await r.json();
        if (settings.external && !settings.external[provider]) {
          return toast('Sign-in isn’t available yet. The site owner still needs to finish setting it up.');
        }
      } catch { /* settings check is best-effort; try signing in anyway */ }
      const { error } = await client.auth.signInWithOAuth({
        provider,
        options: { redirectTo: location.origin + location.pathname },
      });
      if (error) toast(`Sign-in failed: ${error.message}`);
    },

    async signOut() {
      await api.flush();
      await client?.auth.signOut();
      onSignedOut();
      toast('Signed out. Your teams stay saved in your account.');
    },

    queue(team, game) {
      if (!api.user || team.example) return;
      pending.set(team.id, { team, game });
      setStatus('saving');
      clearTimeout(timer);
      timer = setTimeout(() => api.flush(), SAVE_DELAY_MS);
    },

    async flush() {
      clearTimeout(timer);
      if (!api.user || !pending.size) return;
      const batch = [...pending.values()];
      pending.clear();
      const rows = batch.map(({ team, game }) => ({
        id: team.id, user_id: api.user.id, game, name: team.name || 'My team',
        members: team.members, is_public: !!team.isPublic, updated_at: team.updatedAt,
      }));
      const { error } = await client.from('teams').upsert(rows);
      if (error) {
        console.warn('Badge Run: save failed', error);
        for (const b of batch) if (!pending.has(b.team.id)) pending.set(b.team.id, b);
        setStatus('error');
        timer = setTimeout(() => api.flush(), RETRY_MS);
        return;
      }
      for (const { team } of batch) team.syncedAt = team.updatedAt;
      saveLib();
      setStatus(pending.size ? 'saving' : 'saved');
    },

    async remove(team) {
      pending.delete(team.id);
      if (!api.user || !team.syncedAt) return;
      const { error } = await client.from('teams').delete().eq('id', team.id);
      if (error) toast(`Couldn’t delete it from your account: ${error.message}`);
    },

    // A team behind a share link. Works signed out; RLS only returns it while it's public (or yours).
    async fetchShared(id) {
      if (!enabled || !UUID_RE.test(id)) return null;
      client ||= window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
      const { data, error } = await client.from('teams').select('id, game, name, members, is_public').eq('id', id).maybeSingle();
      if (error) console.warn('Badge Run: shared team lookup failed', error);
      return data || null;
    },
  };

  function setStatus(s) {
    api.status = s;
    renderAccount();
  }

  function cleanAuthParams() {
    const url = new URL(location.href);
    let changed = false;
    for (const k of ['code', 'error', 'error_code', 'error_description']) {
      if (url.searchParams.has(k)) {
        if (k === 'error_description') toast(`Sign-in failed: ${url.searchParams.get(k)}`);
        url.searchParams.delete(k); changed = true;
      }
    }
    if (changed) history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  async function onSignedIn(user) {
    api.user = user;
    setStatus('idle');
    const lib = readLib(user.id);
    const { data: rows, error } = await client.from('teams').select('*').eq('user_id', user.id);
    if (error) {
      console.warn('Badge Run: loading teams failed', error);
      toast('Signed in, but your saved teams couldn’t be loaded. Showing this device’s copy.');
    } else {
      mergeRemote(lib, rows);
    }
    const moved = adoptAnonymousTeams(lib);
    useLibrary(user.id, lib);
    if (moved) toast(`Added ${moved} team${moved === 1 ? '' : 's'} from this browser to your account`);
    else toast(`Signed in as ${user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'you'}`);
    await api.flush();
  }

  function onSignedOut() {
    api.user = null;
    pending.clear();
    clearTimeout(timer);
    useLibrary('anon', readLib('anon'));
  }

  // Newest copy wins per team; teams missing from the account were deleted elsewhere unless never uploaded.
  function mergeRemote(lib, rows) {
    const remoteIds = new Set(rows.map(r => r.id));
    for (const r of rows) {
      const gl = (lib[r.game] ||= { active: null, teams: [] });
      const local = gl.teams.find(t => t.id === r.id);
      const remote = { id: r.id, name: r.name, members: r.members, isPublic: r.is_public, updatedAt: r.updated_at, syncedAt: r.updated_at };
      if (!local) gl.teams.push(remote);
      else if (new Date(r.updated_at) >= new Date(local.updatedAt)) Object.assign(local, remote);
      else api.queue(local, r.game);
    }
    for (const [g, gl] of Object.entries(lib)) {
      gl.teams = gl.teams.filter(t => remoteIds.has(t.id) || !t.syncedAt);
      for (const t of gl.teams) if (!t.syncedAt && !t.example && t.members.length) api.queue(t, g);
    }
  }

  // Teams built while signed out move into the account (once), so nothing made before signing in is lost.
  function adoptAnonymousTeams(lib) {
    const anon = readLib('anon');
    let n = 0;
    for (const [g, gl] of Object.entries(anon)) {
      for (const t of gl.teams || []) {
        if (t.example || !t.members?.length) continue;
        const target = (lib[g] ||= { active: null, teams: [] });
        if (target.teams.some(x => x.id === t.id)) continue;
        // Drop the account's untouched placeholder so the adopted team takes its place.
        target.teams = target.teams.filter(x => x.syncedAt || x.members.length);
        target.teams.push(t);
        target.active ||= t.id;
        api.queue(t, g);
        n++;
      }
    }
    if (n) try { localStorage.removeItem(libKey('anon')); } catch { /* ignore */ }
    return n;
  }

  return api;
})();
