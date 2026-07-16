import { authDisclosure } from "@/lib/auth/allowlist";

export default function Home() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Local-only private MVP</p>
        <h1>AI Garmin Connect Trainer</h1>
        <p>
          Sign in with an allowlisted Google account, sync normalized Garmin
          activity/recovery history, and chat with a grounded non-medical
          trainer.
        </p>
      </section>
      <section className="grid">
        <article>
          <h2>Connector</h2>
          <p>
            Run <code>garmin-mcp-auth</code> outside the app, then use Sync now.
            The app uses only pinned stdio read operations and never sees your
            Garmin password.
          </p>
          <button>Verify connector</button>
          <button>Sync now</button>
        </article>
        <article>
          <h2>Recent data</h2>
          <ul>
            <li>Activities paginate to exhaustion.</li>
            <li>
              Daily sleep, RHR, HRV, stress, steps, calories, and Body Battery
              are backfilled from the configured start date.
            </li>
            <li>Missing metrics stay explicit.</li>
          </ul>
        </article>
        <article className="wide">
          <h2>Trainer chat</h2>
          <p>
            Responses cite relevant dates, activities, and trends. Conversation
            history and profile memory persist locally.
          </p>
          <textarea
            aria-label="Message"
            placeholder="Ask about my recent training load…"
          />
          <button>Send</button>
        </article>
        <article>
          <h2>Profile memory</h2>
          <p>
            Goals, sports, preferences, and constraints can be extracted from
            chat and corrected by the operator.
          </p>
        </article>
        <article>
          <h2>Deletion</h2>
          <button>Clear chat/profile</button>
          <button>Disconnect Garmin/delete data</button>
        </article>
      </section>
      <footer>
        <strong>Not medical advice.</strong> Fitness guidance only; seek
        qualified care for medical concerns. Provider disclosure: selected
        conversation context may be sent to the configured AI provider.{" "}
        {authDisclosure()}
      </footer>
    </main>
  );
}
