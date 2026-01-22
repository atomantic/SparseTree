import { fsc } from "./fs.client.js";

// Transient network error codes that should trigger retry
const TRANSIENT_ERROR_CODES = [
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
];

export const fscget = async (url) =>
  new Promise((resolve, reject) => {
    fsc.get(url, (error, response) => {
      // Handle network-level errors (no response received)
      if (error) {
        const errorCode = error.code || error.errno;
        const isTransient = TRANSIENT_ERROR_CODES.includes(errorCode);
        return reject({
          isNetworkError: true,
          isTransient,
          code: errorCode,
          message: error.message || String(error),
          originalError: error,
        });
      }

      // Handle HTTP errors (response received but with error status)
      if (response.statusCode >= 400) {
        const errors = response?.data?.errors;
        console.error(errors || response);
        if (errors && errors[0]?.label === "Unauthorized") {
          console.error(
            `your FS_ACCESS_TOKEN is invalid, please use a new one.`
          );
          process.exit(1);
        }
        return reject({
          isNetworkError: false,
          isTransient: response.statusCode >= 500, // 5xx errors are often transient
          statusCode: response.statusCode,
          data: response.data,
          errors: errors,
        });
      }

      resolve(response.data);
    });
  });

export default fscget;
