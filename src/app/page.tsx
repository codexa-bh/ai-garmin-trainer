import { authDisclosure } from "@/lib/auth/allowlist";
import { TrainerDashboard } from "./trainer-dashboard";

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
      <TrainerDashboard />
      <footer>
        <strong>Not medical advice.</strong> Fitness guidance only; seek
        qualified care for medical concerns. Provider disclosure: selected
        conversation context may be sent to the configured AI provider.{" "}
        {authDisclosure()}
      </footer>
    </main>
  );
}
