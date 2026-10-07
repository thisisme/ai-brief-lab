<?php
declare(strict_types=1);

$items = [
    ['sku' => 'A-100', 'qty' => 12],
    ['sku' => 'B-200', 'qty' => 0],
    ['sku' => 'C-300', 'qty' => 7],
];
?>
<ul>
<?php foreach ($items as $item): ?>
  <li><?= htmlspecialchars($item['sku']) ?>: <?= htmlspecialchars((string) $item['qty']) ?></li>
<?php endforeach; ?>
</ul>
<?php
// php rule loaded
