const TEMPLATE_TOKEN_REGEX = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * Renders known prompt template tokens.
 * Unknown tokens are intentionally left unchanged.
 */
export const renderTemplate = (template: string, vars: Record<string, string>): string => {
  const safeTemplate = typeof template === 'string' ? template : '';
  const safeVars = vars && typeof vars === 'object' ? vars : {};

  try {
    return safeTemplate.replace(TEMPLATE_TOKEN_REGEX, (match, tokenName: string) => {
      const value = safeVars[tokenName];
      return typeof value === 'string' ? value : match;
    });
  } catch {
    return safeTemplate;
  }
};

