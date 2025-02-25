import { BaseContextItem } from "@maiar-ai/core";

export function getTopicTemplate(context: BaseContextItem[]): string {
    return `
       You are an RSS helper. The user is requesting that you add a new topic to an RSS feed.
       Using the provided context, extrapolate the topic name that you need to add to the RSS feed.

       Here is the context:
       ${JSON.stringify(context)}

       You will output your response in JSON format with a single item called "query".

       {
        "query": "<topic query>"
       }
    `;
}

export function getFeedTemplate(context: BaseContextItem[]): string {
    return `
       You are an RSS helper. The user is requesting that you add a new RSS feed.
       Using the provided context, extrapolate the feed name and URL.

       Here is the context:
       ${JSON.stringify(context)}

       You will output your response in JSON format with two items:
       - name: A descriptive name for the feed
       - url: The RSS feed URL

       {
        "name": "<feed name>",
        "url": "<feed url>"
       }
    `;
}