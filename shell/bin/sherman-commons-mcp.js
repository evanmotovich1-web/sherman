#!/usr/bin/env node

import { runCommonsMcpStdio } from '../src/commons/mcp.js';

runCommonsMcpStdio().catch(() => {
    // Stdout is reserved for JSON-RPC and errors must never echo input,
    // credentials, keys, tokens, or raw server responses.
    process.stderr.write('Sherman Commons MCP stopped safely.\n');
    process.exitCode = 1;
});
