import { EnvironmentError } from './errors/environment-error';

function getEnvOrThrow(
  name: string,
  defaultValue: string | undefined = undefined,
) {
  const value = process.env[name] || defaultValue;
  if (value === undefined) {
    throw new EnvironmentError(name);
  }
  return value;
}
export const SERVICE_CONFIGURATION_SERVICE_HTTP = getEnvOrThrow(
  'SERVICE_CONFIGURATION_SERVICE_HTTP',
);
export const NODE_ENV = getEnvOrThrow('NODE_ENV', 'development');
export const IS_DEV = NODE_ENV === 'development';
export const PORT = parseInt(getEnvOrThrow('PORT', '3236'), 10);
