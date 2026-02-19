const UNKNOWN_GIT_SHA = 'unknown';

function resolveGitSha(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    process.env.COMMIT_SHA ??
    UNKNOWN_GIT_SHA
  );
}

function resolveBuildTimeISO(): string {
  return process.env.BUILD_TIME_ISO ?? new Date().toISOString();
}

export async function GET() {
  return Response.json(
    {
      gitSha: resolveGitSha(),
      buildTimeISO: resolveBuildTimeISO(),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
