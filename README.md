# Ghost BunnyCDN Perma-Cache Purger

## Overview

This project acts as a proxy between a Ghost CMS instance and BunnyCDN. It efficiently forwards client requests to Ghost CMS and handles the responses. While doing so, it monitors responses for the [`X-Cache-Invalidate` header](https://github.com/TryGhost/Ghost/issues/570), which signals the need to purge the cache.

In this project specifically, it is used to purge the cache of a specified BunnyCDN pull zone. This functionality ensures that the cache remains synchronized with the latest content updates from Ghost CMS.

Originally developed as part of the BunnyCDN Perma-Cache integration at [Magic Pages](https://magicpages.co), a managed Ghost CMS hosting service, this tool can also help self-hosters using BunnyCDN to keep their cache up-to-date with their Ghost CMS instance.

While designed for use within a Docker Compose environment, other usage configurations are technically possible but not tested.

### Setting up BunnyCDN
If you don't have BunnyCDN set up yet, you can follow the tutorial [on the Magic Pages blog](https://www.magicpages.co/blog/setting-up-bunnycdn-with-ghost-cms/) to get started.

## Usage

The `magicpages/bunnycdn-perma-cache-purger` Docker image is available on [Docker Hub](https://hub.docker.com/r/magicpages/bunnycdn-perma-cache-purger). It can be used to deploy the proxy as part of a Docker Compose stack alongside Ghost.

### Environment Variables

- `PORT`: Optional. The port on which the proxy listens for incoming requests. Defaults to `3000`.
- `GHOST_URL`: The URL of your Ghost CMS instance. Ideally, the hostname of your Ghost container and the port it listens on (e.g., `http://ghost:2368`).
- `BUNNYCDN_API_KEY`: Your BunnyCDN API key.
- `BUNNYCDN_PULL_ZONE_ID`: The ID of the BunnyCDN pull zone that you wish to purge.

These variables must be set in the Docker Compose file or as part of your Docker container configuration.

### Example Docker Compose Configuration

The `docker-compose.yml` is a functional example of how to deploy Ghost, MySQL, and the BunnyCDN Perma-Cache Purger as part of a Docker Compose stack.

```yaml
version: '3.8'

services:
  mysql:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: example
      MYSQL_DATABASE: ghost
      MYSQL_USER: ghost
      MYSQL_PASSWORD: ghost
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 10s

  ghost:
    image: ghost:latest
    environment:
      url: http://localhost:2368
      database__client: mysql
      database__connection__host: mysql
      database__connection__user: ghost
      database__connection__password: ghost
      database__connection__database: ghost
    volumes:
      - ghost_data:/var/lib/ghost/content
    depends_on:
      mysql:
        condition: service_healthy

  bunnycdn-perma-cache-purger:
    image: magicpages/bunnycdn-perma-cache-purger:latest
    environment:
      GHOST_URL: http://ghost:2368
      BUNNYCDN_API_KEY: your_bunnycdn_api_key
      BUNNYCDN_PULL_ZONE_ID: your_pull_zone_id
    depends_on:
      ghost:
        condition: service_started
    ports:
      - "2368:3000"

volumes:
  ghost_data:
  mysql_data:
```

In this example, the Ghost CMS instance is accessible at `http://localhost:2368`. Port `2368` is usually the default port on which Ghost listens, but since we want to catch the `X-Cache-Invalidate` header, we don't expose Ghost directly. Instead, the proxy listens on that port and forwards requests to Ghost.

## How It Works
In a nutshell, this proxy forwards all incoming requests to the Ghost instance that's specified in the `GHOST_URL` environment variable. All responses from Ghost are forwarded back to the client, while the proxy monitors the responses for the `X-Cache-Invalidate` header.

If the header is present, the proxy sends a purge request to the BunnyCDN API to clear the cache of the specified pull zone.

### Under the Hood
The proxy is built using Node.js and a simple Express server. Nothing fancy, just a few lines of code to handle the requests and responses.

And yes, that is the exact code that's running in production at Magic Pages 😉

## License
This project is licensed under the MIT License, so feel free to do whatever you want with it. If you find it useful, I'd love to hear about it!

## Contributing
If you have any ideas for improvements or new features, feel free to open an issue or submit a pull request. Always happy to make things even better and more useful!