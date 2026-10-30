import { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from "axios";
import { getApiDocumentation } from "./generated.js";
import { routes } from "./routes.js";
type Route = (typeof routes)[number];
type GeneratedOperations = ReturnType<typeof getApiDocumentation>;
type NormalizeRoutePath<Path extends string> = Path extends `${infer Prefix}{${string}}${infer Suffix}` ? `${Prefix}{param}${NormalizeRoutePath<Suffix>}` : Path;
type RoutePath = NormalizeRoutePath<Route["path"]>;
export type FlixerApiOperationName = keyof GeneratedOperations;
export type FlixerApiOperationData<Name extends FlixerApiOperationName> = Awaited<ReturnType<GeneratedOperations[Name]>> extends AxiosResponse<infer Data> ? Data : never;
export type FlixerApiOperationParameters<Name extends FlixerApiOperationName> = Parameters<GeneratedOperations[Name]>;
type RouteFor<Method extends Route["method"], Path extends RoutePath> = Extract<Route, {
    method: Method;
}> extends infer Candidate ? Candidate extends Route ? NormalizeRoutePath<Candidate["path"]> extends Path ? Candidate : never : never : never;
type OperationForRoute<Method extends Route["method"], Path extends RoutePath> = RouteFor<Method, Path> extends {
    operationId: infer Name extends FlixerApiOperationName;
} ? Name : never;
type RouteArguments<Method extends Route["method"], Path extends RoutePath> = FlixerApiOperationParameters<OperationForRoute<Method, Path>>;
type TupleOfLength<Length extends number, Tuple extends unknown[] = []> = Tuple["length"] extends Length ? Tuple : TupleOfLength<Length, [...Tuple, unknown]>;
type Add<Left extends number, Right extends number> = [
    ...TupleOfLength<Left>,
    ...TupleOfLength<Right>
]["length"];
type PathParameterCount<Method extends Route["method"], Path extends RoutePath> = RouteFor<Method, Path>["pathParameters"]["length"];
type QueryParameterIndex<Method extends Route["method"], Path extends RoutePath> = Add<PathParameterCount<Method, Path>, RouteFor<Method, Path>["hasBody"] extends true ? 1 : 0>;
/** Response data inferred from the generated operation for a method and OpenAPI path. */
export type FlixerApiRouteData<Method extends Route["method"], Path extends RoutePath> = FlixerApiOperationData<OperationForRoute<Method, Path>>;
/** Positional arguments accepted by the generated operation for a method and OpenAPI path. */
export type FlixerApiRouteParameters<Method extends Route["method"], Path extends RoutePath> = RouteArguments<Method, Path>;
/** Request body accepted by the generated operation, if it has one. */
export type FlixerApiRouteBody<Method extends Route["method"], Path extends RoutePath> = RouteFor<Method, Path>["hasBody"] extends true ? NonNullable<RouteArguments<Method, Path>[PathParameterCount<Method, Path>]> : never;
/** Query parameters accepted by the generated operation, if it has any. */
export type FlixerApiRouteQuery<Method extends Route["method"], Path extends RoutePath> = RouteFor<Method, Path>["hasQuery"] extends true ? NonNullable<RouteArguments<Method, Path>[QueryParameterIndex<Method, Path> & keyof RouteArguments<Method, Path>]> : never;
export type FlixerApiClient = GeneratedOperations & {
    get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    head<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    options<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    request<T = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<T>>;
};
export declare function createFlixerApiClient(axiosInstance?: AxiosInstance): FlixerApiClient;
export {};
