<?php

declare(strict_types=1);
$products = [
	['sku' => 'A-100', 'qty' => 12],
	['sku' => 'B-200', 'qty' => 0],
	['sku' => 'C-300', 'qty' => 7],
];
?>
<script type="module" src="/build/elements.js"></script>

<?php foreach ($products as $p): ?>
	<stock-badge sku="<?= htmlspecialchars($p['sku']) ?>"
		qty="<?= (int) $p['qty'] ?>" low-at="5"></stock-badge>
<?php endforeach; ?>

<lab-counter count="3"></lab-counter>

<script>
	document.addEventListener('restock', (e) => console.log('restock', JSON.stringify(e.detail)));
</script>