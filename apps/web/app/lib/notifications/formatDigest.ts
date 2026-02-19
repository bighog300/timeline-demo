type DigestLike = {
  subject: string;
  stats?: { risks?: number; openLoops?: number; decisions?: number; actions?: number };
  top?: {
    risks?: Array<{ text: string; severity?: string; owner?: string; dueDateISO?: string }>;
    openLoops?: Array<{ text: string; owner?: string; dueDateISO?: string; status?: string }>;
    decisions?: Array<{ text: string; dateISO?: string; owner?: string }>;
    actions?: Array<{ type: string; text: string; dueDateISO?: string }>;
  };
  links?: { drilldownUrl?: string; reportUrl?: string; synthesisUrl?: string };
};

const cap = (value: string, max = 180) => value.slice(0, max);

export const formatDigest = ({
  digest,
  job,
  recipient,
  maxItems,
  includeReportLink,
}: {
  digest: DigestLike;
  job: { id: string; type: 'week_in_review' | 'alerts'; runKey: string; dateFromISO?: string; dateToISO?: string; lookbackStartISO?: string; nowISO?: string };
  recipient: { key: string; profileName?: string };
  maxItems: number;
  includeReportLink?: boolean;
}) => {
  const risks = digest.top?.risks?.slice(0, maxItems) ?? [];
  const openLoops = digest.top?.openLoops?.slice(0, maxItems) ?? [];
  const decisions = digest.top?.decisions?.slice(0, maxItems) ?? [];
  const actions = digest.top?.actions?.slice(0, maxItems) ?? [];
  const summaryLine = `Risks: ${digest.stats?.risks ?? 0} | Open loops: ${digest.stats?.openLoops ?? 0} | Decisions: ${digest.stats?.decisions ?? 0}`;

  const slackText = [
    digest.subject,
    summaryLine,
    ...risks.map((item) => `• Risk: ${cap(item.text)}`),
    ...openLoops.map((item) => `• Open loop: ${cap(item.text)}`),
    ...decisions.map((item) => `• Decision: ${cap(item.text)}`),
    ...(digest.links?.drilldownUrl ? [`Drilldown: ${digest.links.drilldownUrl}`] : []),
    ...(includeReportLink !== false && digest.links?.reportUrl ? [`Report: ${digest.links.reportUrl}`] : []),
    ...(digest.links?.synthesisUrl ? [`Synthesis: ${digest.links.synthesisUrl}`] : []),
  ].join('\n');

  const webhookPayload = {
    version: 1 as const,
    job,
    recipient,
    summary: {
      risks: digest.stats?.risks ?? 0,
      openLoops: digest.stats?.openLoops ?? 0,
      decisions: digest.stats?.decisions ?? 0,
      actions: digest.stats?.actions ?? 0,
    },
    top: {
      ...(risks.length ? { risks } : {}),
      ...(openLoops.length ? { openLoops } : {}),
      ...(decisions.length ? { decisions } : {}),
      ...(actions.length ? { actions } : {}),
    },
    links: {
      dashboardUrl: '/timeline/dashboard',
      drilldownUrl: digest.links?.drilldownUrl,
      reportUrl: includeReportLink === false ? undefined : digest.links?.reportUrl,
      synthesisUrl: digest.links?.synthesisUrl,
    },
  };

  return { slackText, webhookPayload };
};
