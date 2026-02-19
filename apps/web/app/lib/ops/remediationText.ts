export const getAuthRemediation = ({
  missingRefreshToken,
  insufficientScope,
}: {
  missingRefreshToken: boolean;
  insufficientScope: boolean;
}) => {
  const steps = [
    'Sign out of the app.',
    'Revoke app access in Google Account → Security → Third-party access (or “Connections”).',
    'Sign in again and approve the requested permissions.',
  ];

  if (insufficientScope) {
    steps.push('If Gmail send or Calendar scopes were added recently, re-consent is required before scheduled runs can send notifications.');
  }

  if (missingRefreshToken) {
    steps.push('Ensure offline access is granted; if prompted, choose Continue/Allow so background runs can refresh tokens.');
  }

  return {
    title: 'Google permissions need to be refreshed',
    steps,
  };
};
