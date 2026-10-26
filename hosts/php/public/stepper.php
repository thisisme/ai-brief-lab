<?php

declare(strict_types=1);

// The same order as order.php, but each quantity is a real <input type="number">
// that PHP renders. <qty-stepper> adds − and + around it once JavaScript runs.
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
}
require __DIR__ . '/../lib/html.php';
?>
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Order (enhanced inputs)</title>
<style>
	qty-stepper {
		display: inline-flex;
		gap: 4px;
		align-items: center;
	}

	qty-stepper input {
		width: 4em;
		font: inherit;
	}

	qty-stepper button {
		min-width: 2em;
	}

	input:user-invalid {
		outline: 2px solid #c6613f;
	}
</style>
<script type="module" src="/build/elements.js"></script>
<form method="post" id="order">
	<?php foreach ($products as $p): $id = 'q-' . $p['sku']; ?>
		<p>
			<label for="<?= e($id) ?>"><?= e($p['name']) ?></label>
			<qty-stepper>
				<input id="<?= e($id) ?>" type="number" name="qty[<?= e($p['sku']) ?>]"
					value="0" min="0" max="<?= $p['stock'] ?>" step="1" inputmode="numeric">
			</qty-stepper>
		</p>
	<?php endforeach; ?>
	<button type="reset">Reset</button>
	<button>Order</button>
</form>
<?php if ($result !== null): ?>
	<pre id="result"><?= e(json_encode($result, JSON_UNESCAPED_UNICODE)) ?></pre>
<?php endif; ?>

</html>