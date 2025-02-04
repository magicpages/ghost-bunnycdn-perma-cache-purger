import type { Request, Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import httpProxy from 'http-proxy';
import type { ProxyConfig } from './types';
import { errorHtml } from './util.js';
import { CacheManager } from './cache-manager.js';

export class ProxyManager {
  private proxy: httpProxy;
  private cacheManager: CacheManager;

  constructor(private readonly config: ProxyConfig) {
    this.cacheManager = new CacheManager(config);
    this.proxy = this.createProxy();
  }

  private createProxy(): httpProxy {
    const proxy = httpProxy.createProxyServer({
      target: this.config.ghostUrl,
      secure: false,
      changeOrigin: true,
      selfHandleResponse: true,
      xfwd: true,
      headers: {
        'X-Forwarded-Proto': 'https'
      }
    });

    this.setupProxyEventHandlers(proxy);
    return proxy;
  }

  private setupProxyEventHandlers(proxy: httpProxy): void {
    proxy.on('proxyReq', (proxyReq, req, res, options) => {
      this.handleProxyRequest(proxyReq, req as Request, res as Response, options);
    });
    proxy.on('proxyRes', (proxyRes, req, res) => {
      this.handleProxyResponse(proxyRes, req as Request, res as Response);
    });
    proxy.on('error', (err, req, res) => {
      this.handleProxyError(err, req as Request, res as Response);
    });
  }

  private handleProxyRequest(
    proxyReq: any,
    req: Request,
    res: Response,
    options: httpProxy.ServerOptions
  ): void {
    console.log('🔄 Proxying request:', req.method, req.url);
    if (this.config.debug) {
      console.log('📋 Headers:', req.headers);
    }

    const originalIp = req.headers['x-original-forwarded-for'] || req.connection.remoteAddress;
    proxyReq.setHeader('x-forwarded-for', originalIp as string);
    proxyReq.setHeader('x-real-ip', originalIp as string);

    if ((req as any).rawBody?.length > 0) {
      proxyReq.setHeader('Content-Length', (req as any).rawBody.length.toString());
      proxyReq.write((req as any).rawBody);
    }
  }

  private handleProxyResponse(
    proxyRes: IncomingMessage,
    req: Request,
    res: Response
  ): void {
    console.log('↩️ Response:', proxyRes.statusCode, req.method, req.url);
    if (this.config.debug) {
      console.log('📋 Response headers:', proxyRes.headers);
    }

    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);

    proxyRes.on('end', () => {
      if (proxyRes.headers['x-cache-invalidate']) {
        console.log('🔄 Detected x-cache-invalidate header, scheduling cache purge...');
        this.cacheManager.debouncePurgeCache().catch(console.error);
      }
    });
  }

  private handleProxyError(err: Error, req: Request, res: Response): void {
    console.error('❌ Error during proxy operation:', err);
    res.status(503).send(errorHtml);
  }

  public handleRequest = (req: Request, res: Response): void => {
    this.proxy.web(req, res, { target: this.config.ghostUrl });
  };
} 