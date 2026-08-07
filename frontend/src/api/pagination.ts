/**
 * Rows per page for every paged list in the app.
 *
 * One constant rather than a literal per hook, so "page 1 shows 10 and the rest
 * roll to page 2" is true everywhere instead of varying by screen — some lists
 * previously defaulted to 20 while others used 10.
 */
export const DEFAULT_PAGE_SIZE = 10;
