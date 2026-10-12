import { useEffect, useState } from "react";
import { getBestPostingTimes, getAccountHealth } from "../lib/studioApi";
import { useToast } from "../context/ToastContext";

const PLATFORMS = ["", "facebook", "instagram", "threads", "mastodon", "bluesky", "x", "telegram", "discord", "linkedin", "pinterest", "youtube", "tiktok", "reddit"];

function hourLabel(h) { return String(h).padStart(2, "0") + ":00"; }

export default function Insights() {
  const [platform, setPlatform] = useState("");
  const [times, setTimes] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([getBestPostingTimes(platform), getAccountHealth()])
      .then(([t, a]) => { if (alive) { setTimes(t); setAccounts(a.accounts || []); } })
      .catch(error => toast.error(error.message || "Could not load insights."))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [platform]);

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Insights</h1>
        <p className="text-sm text-muted mt-1">Best posting times are learned from your own published posts and their engagement.</p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">Best times to post</h2>
          <select className="input text-sm" value={platform} onChange={e => setPlatform(e.target.value)} aria-label="Platform filter">
            {PLATFORMS.map(p => <option key={p} value={p}>{p || "All platforms"}</option>)}
          </select>
        </div>
        {loading && <p className="text-sm text-muted">Loading…</p>}
        {!loading && times && times.slots.length === 0 && <p className="text-sm text-muted">No engagement data yet. Publish a few posts and sync engagement in Analytics.</p>}
        {!loading && times && times.slots.length > 0 && (
          <>
            {!times.confident && <p className="text-sm text-amber">Only {times.sampleSize} post(s) measured so far — treat these as a rough guide (10+ is reliable).</p>}
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted"><th className="py-1">#</th><th>Day</th><th>Time ({times.timeZone})</th><th>Posts</th><th>Avg score</th></tr></thead>
              <tbody>{times.slots.map(s => <tr key={s.rank} className="border-t border-line"><td className="py-1">{s.rank}</td><td>{s.day}</td><td>{hourLabel(s.hour)}</td><td>{s.posts}</td><td>{s.meanScore}</td></tr>)}</tbody>
            </table>
            {times.nextBestTime && <p className="text-sm">Next best slot: <strong>{new Date(times.nextBestTime).toLocaleString()}</strong></p>}
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Account health</h2>
        <p className="text-xs text-muted">An account is paused automatically after repeated consecutive publishing failures. Re-test it in Accounts to resume.</p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted"><th className="py-1">Account</th><th>Platform</th><th>Status</th><th>Published 30d</th><th>Failed 30d</th><th>Last error</th></tr></thead>
          <tbody>{accounts.map(a => (
            <tr key={a.id} className="border-t border-line">
              <td className="py-1">{a.name}</td><td>{a.platform}</td>
              <td className={a.status === "connected" ? "text-green" : "text-rose"}>{a.status === "error" ? "paused / error" : a.status}</td>
              <td>{a.published_30d}</td><td>{a.failed_30d}</td><td className="truncate max-w-xs" title={a.last_error || ""}>{a.last_error || "—"}</td>
            </tr>))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
