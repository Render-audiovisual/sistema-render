export function shouldSetupDemoData() {
  if (process.env.NODE_ENV === "production") return false;
  const explicitValue = process.env.SETUP_DEMO_DATA;
  if (explicitValue !== undefined) {
    return explicitValue === "true";
  }

  return false;
}
