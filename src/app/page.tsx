import { TrainerDashboard } from "./trainer-dashboard";

export default function Home() {
  return (
    <main className="shell">
      <section className="hero">
        <h1>AI Garmin Connect Trainer</h1>
        <p>
          Open the local trainer, sync normalized Garmin activity/recovery
          history, and chat with a grounded non-medical coach. This app is
          intended for private loopback use only; it does not add a hosted
          account boundary.
        </p>
      </section>
      <TrainerDashboard />
      <footer>
        <strong>Not medical advice.</strong> Fitness guidance only; seek
        qualified care for medical concerns. Provider disclosure: selected
        conversation context may be sent to the configured AI provider. Local
        safety boundary: run on localhost/private loopback only, never public or
        LAN-exposed, and never paste Garmin credentials or token contents into
        the app.
      </footer>
    </main>
  );
}
