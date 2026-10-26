<?php

declare(strict_types=1);

function e(string $s): string
{
	return htmlspecialchars($s, ENT_QUOTES);
}
// php rule loaded
