/*
 * The per-run caps of the follow steps, one number for the executor and the form that states it:
 * a cap only the executor knows reads as "per channel 10" giving five.
 */

/** New videos `youtube_subs` returns in one run, all channels together; the rest count as seen. */
export const YOUTUBE_SUBS_MAX_PER_RUN = 5;

/** New posts `x_posts` returns in one run, all accounts together. */
export const X_POSTS_MAX_PER_RUN = 10;

/** The most trends the `x_trends` form takes: each one opens a page inside the step's time limit. */
export const X_TRENDS_MAX_ITEMS = 30;
