<?php

declare(strict_types=1);

namespace Lab\PhpMcp;

use Mcp\Exception\ToolCallException;

/**
 * Read-only tools that let Claude ask the lab's PHP host what it is running.
 * Nothing here writes a file, opens a network connection or runs a page.
 */
final class LabTools
{
	/** First release on each branch with the October 2026 PHP2Shell fixes. */
	private const FIXED = ['8.5' => '8.5.12', '8.4' => '8.4.27', '8.3' => '8.3.36', '8.2' => '8.2.35'];

	/** ini settings the October 2026 PHP advisories talk about. */
	private const INI = [
		'session.upload_progress.enabled',
		'session.serialize_handler',
		'memory_limit',
		'post_max_size',
		'display_errors',
	];

	private readonly string $root;

	public function __construct(string $phpRoot)
	{
		$real = realpath($phpRoot);
		if (false === $real || !is_dir($real)) {
			throw new \InvalidArgumentException("PHP root not found: {$phpRoot}");
		}
		$this->root = $real;
	}

	/**
	 * Lists the PHP pages under hosts/php/public and counts every PHP file under hosts/php.
	 *
	 * @return array{root: string, pages: list<string>, php_files: int}
	 */
	public function listPages(): array
	{
		$pages = [];
		$count = 0;
		$it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($this->root, \FilesystemIterator::SKIP_DOTS));
		foreach ($it as $file) {
			$rel = substr($file->getPathname(), \strlen($this->root) + 1);
			if (!str_ends_with($rel, '.php') || str_starts_with($rel, 'vendor/')) {
				continue;
			}
			++$count;
			if (str_starts_with($rel, 'public/')) {
				$pages[] = $rel;
			}
		}
		sort($pages);

		return ['root' => 'hosts/php', 'pages' => $pages, 'php_files' => $count];
	}

	/**
	 * Runs php -l on one PHP file under hosts/php and returns PHP's own message.
	 *
	 * @param string $path file path relative to hosts/php, for example public/index.php
	 *
	 * @return array{path: string, ok: bool, message: string}
	 */
	public function lint(string $path): array
	{
		if ('' === $path || str_starts_with($path, '/') || str_contains($path, "\0")) {
			throw new ToolCallException('Give a path relative to hosts/php, for example public/index.php.');
		}
		$file = realpath($this->root . '/' . $path);
		if (false === $file || !str_starts_with($file, $this->root . '/')) {
			throw new ToolCallException("Refused: {$path} is not a file under hosts/php.");
		}
		if (!is_file($file) || !str_ends_with($file, '.php')) {
			throw new ToolCallException("Refused: {$path} is not a .php file.");
		}

		$proc = proc_open([\PHP_BINARY, '-d', 'display_errors=1', '-d', 'log_errors=0', '-l', $file], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
		if (!\is_resource($proc)) {
			throw new ToolCallException('Could not start php -l.');
		}
		$out = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
		fclose($pipes[1]);
		fclose($pipes[2]);
		$code = proc_close($proc);

		$rel = substr($file, \strlen($this->root) + 1);
		$message = trim(str_replace($file, $rel, $out));

		return ['path' => $rel, 'ok' => 0 === $code, 'message' => $message];
	}

	/**
	 * Reports the PHP version, whether it is at or past the October 2026 PHP2Shell fix
	 * for its branch, and the ini settings the advisories mention. These are the CLI's
	 * settings; PHP-FPM or Apache can load a different php.ini.
	 *
	 * @return array<string, mixed>
	 */
	public function runtime(): array
	{
		$branch = \PHP_MAJOR_VERSION . '.' . \PHP_MINOR_VERSION;
		$fixedIn = self::FIXED[$branch] ?? null;
		$ini = [];
		foreach (self::INI as $key) {
			$value = \ini_get($key);
			$ini[$key] = false === $value ? null : $value;
		}

		return [
			'php_version' => \PHP_VERSION,
			'sapi' => \PHP_SAPI,
			'php_ini' => php_ini_loaded_file() ?: null,
			'php2shell_fixed_in' => $fixedIn,
			'php2shell_fixed' => null === $fixedIn ? null : version_compare(\PHP_VERSION, $fixedIn, '>='),
			'ini' => $ini,
			'extensions' => ['curl' => \extension_loaded('curl'), 'mbstring' => \extension_loaded('mbstring'), 'intl' => \extension_loaded('intl')],
			'note' => 'CLI values. Distro packages can carry the fix under an older version number; PHP-FPM or Apache may load another php.ini.',
		];
	}
}
