import axios from "axios";
import { getApiDocumentation } from "./generated.js";
import { routes } from "./routes.js";
function routePattern(path) {
    const escaped = path
        .split(/\{[^}]+\}/g)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("([^/]+)");
    return new RegExp(`^${escaped}/?$`);
}
function findRoute(method, url) {
    const pathname = url.split("?", 1)[0].replace(/\/+$/, "") || "/";
    const route = routes.find((candidate) => candidate.method === method.toLowerCase() && routePattern(candidate.path).test(pathname));
    if (!route) {
        throw new Error(`No generated Flixer API operation matches ${method.toUpperCase()} ${url}`);
    }
    const values = pathname.match(routePattern(route.path))?.slice(1) ?? [];
    return { route, values };
}
function operationOptions(config) {
    const { data: _data, method: _method, url: _url, ...options } = config ?? {};
    return options;
}
export function createFlixerApiClient(axiosInstance = axios) {
    const generatedOperations = getApiDocumentation(axiosInstance);
    const operations = generatedOperations;
    const request = async (method, url, data, config) => {
        const { route, values } = findRoute(method, url);
        const operation = operations[route.operationId];
        if (!operation) {
            throw new Error(`Generated Flixer API operation ${route.operationId} was not found`);
        }
        const args = [...values];
        if (route.hasBody)
            args.push(data);
        if (route.hasQuery)
            args.push(config?.params);
        args.push(operationOptions(config));
        return (await operation(...args));
    };
    return Object.assign(generatedOperations, {
        get: (url, config) => request("get", url, undefined, config),
        delete: (url, config) => request("delete", url, undefined, config),
        head: (url, config) => request("head", url, undefined, config),
        options: (url, config) => request("options", url, undefined, config),
        post: (url, data, config) => request("post", url, data, config),
        put: (url, data, config) => request("put", url, data, config),
        patch: (url, data, config) => request("patch", url, data, config),
        request: (config) => {
            if (!config.url || !config.method) {
                throw new Error("Flixer API requests require both a URL and an HTTP method.");
            }
            return request(config.method, config.url, config.data, config);
        },
    });
}
