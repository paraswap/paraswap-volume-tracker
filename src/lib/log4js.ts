import * as fs from 'fs';
import * as log4js from 'log4js';
import * as path from 'path';
import * as util from 'util';

const isDev = process.env.NODE_ENV === 'development';
const logFile = process.env['LOGGER_PATH'];

const STACK_REGEX = /at (?:(.+)\s+\()?(?:(.+?):(\d+)(?::(\d+))?|([^)]+))\)?/;
function parseCallStack(error: Error, skipIdx = 4) {
  const stackLines = error.stack!.split('\n').slice(skipIdx);
  const lineMatch = STACK_REGEX.exec(stackLines[0]);
  if (lineMatch && lineMatch.length === 6) {
    return {
      functionName: lineMatch[1],
      fileName: lineMatch[2].replace(/^.*[\\/](src|dist|app)[\\/]/, ''), // we added replace to get rid of excessive path
      lineNumber: parseInt(lineMatch[3], 10),
      columnNumber: parseInt(lineMatch[4], 10),
      callStack: stackLines.join('\n'),
    };
  }
  return null;
}

function calculateCategory() {
  const parsed = parseCallStack(new Error(), 3);
  return parsed?.fileName.split('.')[0].split(path.sep).join('.');
}

const configuration: log4js.Configuration = {
  appenders: {
    console: {
      type: 'console',
      layout: {
        type: 'pattern',
        pattern: isDev
          ? '%[[%d] [%p] [%c] [%f:%l]%] %m%n' // Colored for development
          : '[%d] [%p] [%c] %m%n',
      },
    },
  },
  categories: {
    default: {
      appenders: ['console'],
      level: process.env['LOGGER_LEVEL'] || isDev ? 'trace' : 'info',
      enableCallStack: isDev,
    },
    ACCESS_LOG_CATEGORY: {
      appenders: ['console'],
      level: 'info',
    },
  },
};

if (logFile) {
  const logDir = path.dirname(logFile);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }
  configuration.appenders.file = {
    type: 'file',
    filename: logFile,
    maxLogSize: 5242880,
    backups: 5,
  };
  configuration.categories.default.appenders = [
    ...configuration.categories.default.appenders,
    'file',
  ];
}

log4js.configure(configuration);

export const shutdown = () => {
  return new Promise<void>((resolve, reject) => {
    log4js.shutdown(e => {
      if (e) {
        console.warn('Failed shutting down log4js', e);
      }
      resolve();
    });
  });
};

Object.defineProperty(Error.prototype, util.inspect.custom, {
  value: function customErrorInspect(depth: any, options: any) {
    return !isDev || this.isAxiosError === true ? this.toString() : this;
  },
  configurable: true,
  writable: true,
});

declare global {
  namespace NodeJS {
    interface Global {
      LOGGER: (suffix?: string | number, useAsIs?: boolean) => log4js.Logger;
    }
  }
}

global.LOGGER = (suffix?: string | number, useAsIs?: boolean) => {
  let category: string | undefined;
  if (useAsIs === true) {
    category = suffix as string;
  } else {
    category = calculateCategory();
    if (suffix) {
      category = `${category}-${suffix}`;
    }
  }
  const logger = log4js.getLogger(category);
  logger.setParseCallStackFunction(parseCallStack); // override to get rid of filename excessive path
  return logger;
};
