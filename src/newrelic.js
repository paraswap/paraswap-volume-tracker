'use strict';

function hostname() {
  try {
    // parse the ECS injected ECS_CONTAINER_METADATA_URI
    // example value: 'http://169.254.170.2/b427c23cbeed4874aae3e883c67dd87f-2982235661'
    // task id if after the last '/' until the '-'
    const uri = process.env.ECS_CONTAINER_METADATA_URI;
    return uri.matchAll(/\/([a-z0-9]+)-/g).next().value[1];
  } catch (e) {
    return undefined;
  }
}

/**
 * New Relic agent configuration.
 *
 * See lib/config/default.js in the agent distribution for a more complete
 * description of configuration variables and their potential values.
 */
exports.config = {
  process_host: {
    display_name: hostname(),
  },

  /**
   * Your New Relic Logging configuration.
   */
  logging: {
    /**
     * Level at which to log. 'trace' is most useful to New Relic when diagnosing
     * issues with the agent, 'info' and higher will impose the least overhead on
     * production applications.
     */
    level: 'info',
  },
  /**
   * When true, all request headers except for those listed in attributes.exclude
   * will be captured for all traces, unless otherwise specified in a destination's
   * attributes include/exclude lists.
   */
  allow_all_headers: true,
  attributes: {
    /**
     * Prefix of attributes to exclude from all destinations. Allows * as wildcard
     * at end.
     *
     * NOTE: If excluding headers, they must be in camelCase form to be filtered.
     *
     * @env NEW_RELIC_ATTRIBUTES_EXCLUDE
     */
    exclude: [
      'request.headers.cookie',
      'request.headers.authorization',
      'request.headers.proxyAuthorization',
      'request.headers.setCookie*',
      'request.headers.x*',
      'response.headers.cookie',
      'response.headers.authorization',
      'response.headers.proxyAuthorization',
      'response.headers.setCookie*',
      'response.headers.x*',
    ],
  },
};
