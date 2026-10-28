<?php

declare(strict_types=1);

// Starts server.php the way Claude Code does (stdio) and checks every tool.
require __DIR__ . '/vendor/autoload.php';

use Mcp\Client;
use Mcp\Client\Transport\StdioTransport;
use Mcp\Schema\Content\TextContent;

$failed = 0;
$check = function (string $name, bool $ok, string $detail = '') use (&$failed): void {
	echo ($ok ? 'ok   ' : 'FAIL ') . $name . ('' !== $detail ? "  ({$detail})" : '') . "\n";
	$failed += $ok ? 0 : 1;
};
$text = static fn($result): string => implode("\n", array_map(
	static fn($c) => $c instanceof TextContent ? $c->text : '',
	$result->content,
));

$client = Client::builder()->setClientInfo('php-mcp-smoke', '0.1.0')->build();
$client->connect(new StdioTransport(command: \PHP_BINARY, args: [__DIR__ . '/server.php']));

$names = array_map(static fn($t) => $t->name, $client->listTools()->tools);
sort($names);
$check('three read-only tools', ['php_lint', 'php_list_pages', 'php_runtime'] === $names, implode(', ', $names));

$pages = $client->callTool('php_list_pages')->structuredContent ?? [];
$check(
	'lists public/index.php',
	\in_array('public/index.php', $pages['pages'] ?? [], true),
	\count($pages['pages'] ?? []) . ' page(s), ' . ($pages['php_files'] ?? 0) . ' PHP file(s)'
);

$lint = $client->callTool('php_lint', ['path' => 'public/index.php'])->structuredContent ?? [];
$check('clean file lints ok', true === ($lint['ok'] ?? null), $lint['message'] ?? '');

$broken = dirname(__DIR__, 2) . '/hosts/php/public/_mcp_smoke_broken.php';
file_put_contents($broken, "<?php\necho 'x'\necho 'y';\n");
try {
	$bad = $client->callTool('php_lint', ['path' => 'public/_mcp_smoke_broken.php'])->structuredContent ?? [];
} finally {
	unlink($broken);
}
$check('syntax error reported with its line', false === ($bad['ok'] ?? null) && str_contains($bad['message'] ?? '', 'on line 3'), strtok($bad['message'] ?? '', "\n"));

foreach (['../../package.json', 'public/../../../package.json', '/etc/passwd'] as $path) {
	$r = $client->callTool('php_lint', ['path' => $path]);
	$check("refuses {$path}", true === $r->isError && (str_starts_with($text($r), 'Refused') || str_starts_with($text($r), 'Give a path')), $text($r));
}

$rt = $client->callTool('php_runtime')->structuredContent ?? [];
$check(
	'runtime reports this PHP',
	\PHP_VERSION === ($rt['php_version'] ?? null) && \array_key_exists('session.upload_progress.enabled', $rt['ini'] ?? []),
	'PHP ' . ($rt['php_version'] ?? '?') . ', fixed in ' . ($rt['php2shell_fixed_in'] ?? 'n/a') . ', fixed: ' . var_export($rt['php2shell_fixed'] ?? null, true)
);

$client->disconnect();

echo 0 === $failed ? "php-mcp-smoke: all passed\n" : "php-mcp-smoke: {$failed} failed\n";
exit(0 === $failed ? 0 : 1);
