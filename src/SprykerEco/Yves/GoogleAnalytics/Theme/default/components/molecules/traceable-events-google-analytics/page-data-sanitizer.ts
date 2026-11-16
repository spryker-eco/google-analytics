// The query parameters Google Analytics reads for campaign attribution. Every other query parameter, and the fragment, is left out of
// the page URLs sent with every hit, as they may carry personal data, e.g. the token of a password reset link.
export const CAMPAIGN_QUERY_PARAMETERS: ReadonlySet<string> = new Set([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'utm_id',
    'utm_source_platform',
    'utm_creative_format',
    'utm_marketing_tactic',
    'gclid',
    'gbraid',
    'wbraid',
    'dclid',
    '_gl',
]);

// A quote request page has the quote request reference in its path, e.g. /quote-request/details/DE--21-8, and in its title. The
// reference contains the customer reference, so it is left out of the page URLs and the title, for the agent's pages as well.
export const QUOTE_REQUEST_REFERENCE_PATH_PATTERN = /(\/quote-request\/[\w-]+\/)([^/]+)/;

// Origin and path, and only the kept query parameters; an empty or invalid URL, e.g. no referrer, stays empty.
// The adapter passes its own path step, so a project that overrides it changes the URLs as well.
export const getUrlWithoutPersonalData = (
    url: string,
    keptQueryParameters: ReadonlySet<string>,
    getPathWithoutPersonalData: (path: string) => string,
): string => {
    let parsedUrl: URL;

    try {
        parsedUrl = new URL(url);
    } catch {
        return '';
    }

    const keptQuery = new URLSearchParams();

    for (const [name, value] of parsedUrl.searchParams) {
        if (keptQueryParameters.has(name)) {
            keptQuery.append(name, value);
        }
    }

    const query = keptQuery.toString();
    const path = getPathWithoutPersonalData(parsedUrl.pathname);

    return query ? `${parsedUrl.origin}${path}?${query}` : `${parsedUrl.origin}${path}`;
};

export const getPathWithoutQuoteRequestReference = (path: string, quoteRequestReferencePathPattern: RegExp): string =>
    path.replace(quoteRequestReferencePathPattern, '$1');

// The title of a quote request page shows its reference, which the path of the page names.
export const getTitleWithoutQuoteRequestReference = (
    title: string,
    pagePath: string,
    quoteRequestReferencePathPattern: RegExp,
): string => {
    const quoteRequestReferenceMatch = pagePath.match(quoteRequestReferencePathPattern);

    if (!quoteRequestReferenceMatch) {
        return title;
    }

    const quoteRequestReference = decodeURIComponent(quoteRequestReferenceMatch[2]);

    return title.split(quoteRequestReference).join('').trim();
};
