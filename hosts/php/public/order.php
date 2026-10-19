<?php

declare(strict_types=1);

// Stock comes from your database in real life. PHP validates again on POST:
// the element's validation is for the user, this check is the one you trust.
$products = [
	['sku' => 'HLM-001', 'name' => 'Halmstad mug', 'stock' => 12],
	['sku' => 'HLM-002', 'name' => 'Tylösand towel', 'stock' => 3],
];

$result = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
	$posted = is_array($_POST['qty'] ?? null) ? $_POST['qty'] : [];
	$result = ['ok' => true, 'qty' => [], 'errors' => []];
	foreach ($products as $p) {
		$q = filter_var(
			$posted[$p['sku']] ?? null,
			FILTER_VALIDATE_INT,
			['options' => ['min_range' => 0, 'max_range' => $p['stock']]]
		);
		if ($q === false) {
			$result['ok'] = false;
			$result['errors'][] = $p['sku'];
		} else {
			$result['qty'][$p['sku']] = $q;
		}
	}
	$result['note'] = trim((string) ($_POST['note'] ?? ''));
}
$h = fn(string $s): string => htmlspecialchars($s, ENT_QUOTES);
?>
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Order</title>
<script type="module" src="/build/elements.js"></script>
<form method="post" id="order">
	<?php foreach ($products as $p): $id = 'q-' . $p['sku']; ?>
		<p>
			<label for="<?= $h($id) ?>"><?= $h($p['name']) ?></label>
			<qty-input id="<?= $h($id) ?>" name="qty[<?= $h($p['sku']) ?>]" value="0"
				min="0" max="<?= $p['stock'] ?>" label="<?= $h($p['name']) ?>"></qty-input>
			<stock-badge qty="<?= $p['stock'] ?>"></stock-badge>
		</p>
	<?php endforeach; ?>
	<p><label>Note <input name="note"></label></p>
	<button>Order</button>
	<button type="reset">Reset</button>
</form>
<?php if ($result !== null): ?>
	<pre id="result"><?= $h(json_encode($result, JSON_UNESCAPED_UNICODE)) ?></pre>
<?php endif; ?>

</html>