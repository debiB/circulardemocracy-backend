/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */
export var ContentType;
(function (ContentType) {
    ContentType["Json"] = "application/json";
    ContentType["JsonApi"] = "application/vnd.api+json";
    ContentType["FormData"] = "multipart/form-data";
    ContentType["UrlEncoded"] = "application/x-www-form-urlencoded";
    ContentType["Text"] = "text/plain";
})(ContentType || (ContentType = {}));
export class HttpClient {
    baseUrl = "https://api.circulardemocracy.org";
    securityData = null;
    securityWorker;
    abortControllers = new Map();
    customFetch = (...fetchParams) => fetch(...fetchParams);
    baseApiParams = {
        credentials: "same-origin",
        headers: {},
        redirect: "follow",
        referrerPolicy: "no-referrer",
    };
    constructor(apiConfig = {}) {
        Object.assign(this, apiConfig);
    }
    setSecurityData = (data) => {
        this.securityData = data;
    };
    encodeQueryParam(key, value) {
        const encodedKey = encodeURIComponent(key);
        return `${encodedKey}=${encodeURIComponent(typeof value === "number" ? value : `${value}`)}`;
    }
    addQueryParam(query, key) {
        return this.encodeQueryParam(key, query[key]);
    }
    addArrayQueryParam(query, key) {
        const value = query[key];
        return value.map((v) => this.encodeQueryParam(key, v)).join("&");
    }
    toQueryString(rawQuery) {
        const query = rawQuery || {};
        const keys = Object.keys(query).filter((key) => "undefined" !== typeof query[key]);
        return keys
            .map((key) => Array.isArray(query[key])
            ? this.addArrayQueryParam(query, key)
            : this.addQueryParam(query, key))
            .join("&");
    }
    addQueryParams(rawQuery) {
        const queryString = this.toQueryString(rawQuery);
        return queryString ? `?${queryString}` : "";
    }
    contentFormatters = {
        [ContentType.Json]: (input) => input !== null && (typeof input === "object" || typeof input === "string")
            ? JSON.stringify(input)
            : input,
        [ContentType.JsonApi]: (input) => input !== null && (typeof input === "object" || typeof input === "string")
            ? JSON.stringify(input)
            : input,
        [ContentType.Text]: (input) => input !== null && typeof input !== "string"
            ? JSON.stringify(input)
            : input,
        [ContentType.FormData]: (input) => {
            if (input instanceof FormData) {
                return input;
            }
            return Object.keys(input || {}).reduce((formData, key) => {
                const property = input[key];
                formData.append(key, property instanceof Blob
                    ? property
                    : typeof property === "object" && property !== null
                        ? JSON.stringify(property)
                        : `${property}`);
                return formData;
            }, new FormData());
        },
        [ContentType.UrlEncoded]: (input) => this.toQueryString(input),
    };
    mergeRequestParams(params1, params2) {
        return {
            ...this.baseApiParams,
            ...params1,
            ...(params2 || {}),
            headers: {
                ...(this.baseApiParams.headers || {}),
                ...(params1.headers || {}),
                ...(params2?.headers || {}),
            },
        };
    }
    createAbortSignal = (cancelToken) => {
        if (this.abortControllers.has(cancelToken)) {
            const abortController = this.abortControllers.get(cancelToken);
            if (abortController) {
                return abortController.signal;
            }
            return void 0;
        }
        const abortController = new AbortController();
        this.abortControllers.set(cancelToken, abortController);
        return abortController.signal;
    };
    abortRequest = (cancelToken) => {
        const abortController = this.abortControllers.get(cancelToken);
        if (abortController) {
            abortController.abort();
            this.abortControllers.delete(cancelToken);
        }
    };
    request = async ({ body, secure, path, type, query, format, baseUrl, cancelToken, ...params }) => {
        const secureParams = ((typeof secure === "boolean" ? secure : this.baseApiParams.secure) &&
            this.securityWorker &&
            (await this.securityWorker(this.securityData))) ||
            {};
        const requestParams = this.mergeRequestParams(params, secureParams);
        const queryString = query && this.toQueryString(query);
        const payloadFormatter = this.contentFormatters[type || ContentType.Json];
        const responseFormat = format || requestParams.format;
        return this.customFetch(`${baseUrl || this.baseUrl || ""}${path}${queryString ? `?${queryString}` : ""}`, {
            ...requestParams,
            headers: {
                ...(requestParams.headers || {}),
                ...(type && type !== ContentType.FormData
                    ? { "Content-Type": type }
                    : {}),
            },
            signal: (cancelToken
                ? this.createAbortSignal(cancelToken)
                : requestParams.signal) || null,
            body: typeof body === "undefined" || body === null
                ? null
                : payloadFormatter(body),
        }).then(async (response) => {
            const r = response;
            r.data = null;
            r.error = null;
            const responseToParse = responseFormat ? response.clone() : response;
            const data = !responseFormat
                ? r
                : await responseToParse[responseFormat]()
                    .then((data) => {
                    if (r.ok) {
                        r.data = data;
                    }
                    else {
                        r.error = data;
                    }
                    return r;
                })
                    .catch((e) => {
                    r.error = e;
                    return r;
                });
            if (cancelToken) {
                this.abortControllers.delete(cancelToken);
            }
            if (!response.ok) {
                throw data;
            }
            return data;
        });
    };
}
/**
 * @title Circular Democracy API
 * @version 1.0.0
 * @baseUrl https://api.circulardemocracy.org
 *
 * API for processing citizen messages to politicians
 */
export class Api extends HttpClient {
    api = {
        /**
         * @description Receives a citizen message, classifies it by campaign, and stores it for politician response
         *
         * @tags Messages
         * @name V1MessagesCreate
         * @summary Process incoming citizen message
         * @request POST:/api/v1/messages
         */
        v1MessagesCreate: (data, params = {}) => this.request({
            path: "/api/v1/messages",
            method: "POST",
            body: data,
            type: ContentType.Json,
            format: "json",
            ...params,
        }),
        /**
         * No description
         *
         * @tags Campaigns
         * @name V1CampaignsList
         * @request GET:/api/v1/campaigns
         * @secure
         */
        v1CampaignsList: (params = {}) => this.request({
            path: "/api/v1/campaigns",
            method: "GET",
            secure: true,
            format: "json",
            ...params,
        }),
        /**
         * No description
         *
         * @tags Campaigns
         * @name V1CampaignsCreate
         * @request POST:/api/v1/campaigns
         * @secure
         */
        v1CampaignsCreate: (data, params = {}) => this.request({
            path: "/api/v1/campaigns",
            method: "POST",
            body: data,
            secure: true,
            type: ContentType.Json,
            format: "json",
            ...params,
        }),
        /**
         * No description
         *
         * @tags Campaigns
         * @name V1CampaignsDetail
         * @request GET:/api/v1/campaigns/{id}
         * @secure
         */
        v1CampaignsDetail: (id, params = {}) => this.request({
            path: `/api/v1/campaigns/${id}`,
            method: "GET",
            secure: true,
            format: "json",
            ...params,
        }),
        /**
         * No description
         *
         * @tags Campaigns, Statistics
         * @name V1CampaignsStatsList
         * @summary Get campaign statistics
         * @request GET:/api/v1/campaigns/stats
         * @secure
         */
        v1CampaignsStatsList: (params = {}) => this.request({
            path: "/api/v1/campaigns/stats",
            method: "GET",
            secure: true,
            format: "json",
            ...params,
        }),
        /**
         * No description
         *
         * @tags Politicians
         * @name V1PoliticiansList
         * @request GET:/api/v1/politicians
         * @secure
         */
        v1PoliticiansList: (params = {}) => this.request({
            path: "/api/v1/politicians",
            method: "GET",
            secure: true,
            format: "json",
            ...params,
        }),
        /**
         * No description
         *
         * @tags Politicians
         * @name V1PoliticiansDetail
         * @request GET:/api/v1/politicians/{id}
         * @secure
         */
        v1PoliticiansDetail: (id, params = {}) => this.request({
            path: `/api/v1/politicians/${id}`,
            method: "GET",
            secure: true,
            format: "json",
            ...params,
        }),
        /**
         * No description
         *
         * @tags Reply Templates
         * @name V1ReplyTemplatesList
         * @request GET:/api/v1/reply-templates
         * @secure
         */
        v1ReplyTemplatesList: (params = {}) => this.request({
            path: "/api/v1/reply-templates",
            method: "GET",
            secure: true,
            format: "json",
            ...params,
        }),
        /**
         * No description
         *
         * @tags Reply Templates
         * @name V1ReplyTemplatesCreate
         * @request POST:/api/v1/reply-templates
         * @secure
         */
        v1ReplyTemplatesCreate: (data, params = {}) => this.request({
            path: "/api/v1/reply-templates",
            method: "POST",
            body: data,
            secure: true,
            type: ContentType.Json,
            format: "json",
            ...params,
        }),
        /**
         * No description
         *
         * @tags Reply Templates
         * @name V1ReplyTemplatesDetail
         * @request GET:/api/v1/reply-templates/{id}
         * @secure
         */
        v1ReplyTemplatesDetail: (id, params = {}) => this.request({
            path: `/api/v1/reply-templates/${id}`,
            method: "GET",
            secure: true,
            format: "json",
            ...params,
        }),
    };
}
