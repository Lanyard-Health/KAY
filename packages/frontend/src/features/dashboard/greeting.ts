// Time-aware greeting for the dashboard headline. Falls back to the brand
// welcome when we don't have the user's first name yet. `hour` is injectable
// for testing; it defaults to the current local hour.
export function dashboardGreeting(firstName?: string, hour: number = new Date().getHours()): string {
  if (!firstName) return 'Welcome to Lanyard Health';
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${firstName}`;
}
