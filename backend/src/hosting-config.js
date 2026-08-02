export function shouldSetupDemoData() {
  const explicitValue = process.env.SETUP_DEMO_DATA;
  if (explicitValue !== undefined) {
    return explicitValue === "true";
  }

  return process.env.NODE_ENV !== "production";
}
