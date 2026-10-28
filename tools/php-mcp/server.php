#!/usr/bin/env php
<?php

declare(strict_types=1);

// stdout belongs to JSON-RPC: never echo or print here or in LabTools.
require __DIR__ . '/vendor/autoload.php';

use Lab\PhpMcp\LabTools;
use Mcp\Schema\ToolAnnotations;
use Mcp\Server;
use Mcp\Server\Transport\StdioTransport;

$tools = new LabTools(dirname(__DIR__, 2) . '/hosts/php');
$readOnly = new ToolAnnotations(readOnlyHint: true, destructiveHint: false, openWorldHint: false);

$server = Server::builder()
	->setServerInfo('php-lab', '0.1.0')
	->addTool(
		[$tools, 'listPages'],
		'php_list_pages',
		annotations: $readOnly,
		description: 'List the PHP pages under hosts/php/public and count the PHP files under hosts/php.'
	)
	->addTool(
		[$tools, 'lint'],
		'php_lint',
		annotations: $readOnly,
		description: 'Run php -l on one file under hosts/php (path relative to hosts/php, e.g. public/index.php).'
	)
	->addTool(
		[$tools, 'runtime'],
		'php_runtime',
		annotations: $readOnly,
		description: 'PHP version, whether it has the October 2026 PHP2Shell fix for its branch, and the ini settings the advisories mention (CLI values).'
	)
	->build();

exit($server->run(new StdioTransport()));
