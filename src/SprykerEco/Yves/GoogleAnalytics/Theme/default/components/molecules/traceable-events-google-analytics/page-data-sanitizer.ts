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

// Page paths with personal data in one segment, as JavaScript regular expressions: the first capture group is the part of the path kept,
// the second one the segment left out of the page URLs and, decoded, out of the page title. Used while the project sets none, see
// GoogleAnalyticsConfig::getPersonalDataPagePathPatterns().
// - A quote request reference, e.g. /quote-request/details/DE--21-8, contains the customer reference, for the agent's pages as well.
// - A wishlist name, e.g. /wishlist/details/Birthday%20Anna, is chosen by the customer.
export const DEFAULT_PERSONAL_DATA_PAGE_PATH_PATTERNS: readonly string[] = [
    '(/quote-request/[\\w-]+/)([^/]+)',
    '(/wishlist/[\\w-]+/)([^/]+)',
];

// A pattern that is no valid regular expression, e.g. from a project config, is left out instead of breaking every hit.
export const createPagePathPatterns = (patternSources: readonly string[]): RegExp[] => {
    const pagePathPatterns: RegExp[] = [];

    for (const patternSource of patternSources) {
        try {
            pagePathPatterns.push(new RegExp(patternSource));
        } catch {
            continue;
        }
    }

    return pagePathPatterns;
};

const removePersonalDataFromPath = (path: string, pagePathPatterns: readonly RegExp[]): string =>
    pagePathPatterns.reduce((sanitizedPath, pagePathPattern) => sanitizedPath.replace(pagePathPattern, '$1'), path);

// A segment that is no valid URI encoding, e.g. in a hand-made link, is removed as it is written.
const decodePathSegment = (segment: string): string => {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
};

// Origin and path without the personal data segments, and only the kept query parameters; an empty or invalid URL, e.g. no referrer,
// stays empty.
export const removePersonalDataFromUrl = (
    url: string,
    keptQueryParameters: ReadonlySet<string>,
    pagePathPatterns: readonly RegExp[],
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
    const path = removePersonalDataFromPath(parsedUrl.pathname, pagePathPatterns);

    return query ? `${parsedUrl.origin}${path}?${query}` : `${parsedUrl.origin}${path}`;
};

// The title of such a page usually shows the segment, e.g. the quote request reference or the wishlist name.
export const removePersonalDataFromTitle = (
    title: string,
    pagePath: string,
    pagePathPatterns: readonly RegExp[],
): string => {
    let sanitizedTitle = title;

    for (const pagePathPattern of pagePathPatterns) {
        const personalDataMatch = pagePath.match(pagePathPattern);
        const personalData = personalDataMatch?.[2] ? decodePathSegment(personalDataMatch[2]) : '';

        if (personalData) {
            sanitizedTitle = sanitizedTitle.split(personalData).join('');
        }
    }

    return sanitizedTitle.trim();
};
