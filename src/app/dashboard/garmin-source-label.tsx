export function GarminSourceLabel({
  context = "Source",
}: {
  context?: string;
}) {
  return <span className="garmin-source-label">{context}: Garmin</span>;
}
