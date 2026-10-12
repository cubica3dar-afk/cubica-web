// Solo acepta filas leídas por el worker desde Supabase, nunca un plan del navegador.
const SCALE = 10000;
const units = value => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER / SCALE) {
    throw new Error("Cantidad de inventario inválida");
  }
  return Math.round(number * SCALE);
};

export function calculateProductionPlan(items, recipes, supplies) {
  const productMap = new Map();
  const supplyMap = new Map(supplies.map(supply => [supply.id, supply]));
  const recipeMap = new Map();
  for (const recipe of recipes) {
    const rows = recipeMap.get(recipe.product_id) || [];
    rows.push(recipe);
    recipeMap.set(recipe.product_id, rows);
  }
  for (const item of items) {
    if (!Number.isSafeInteger(Number(item.qty)) || Number(item.qty) <= 0) {
      throw new Error("Cantidad de pedido inválida");
    }
    const key = item.product_id || `deleted:${item.id}`;
    const product = productMap.get(key) || {
      productId: item.product_id,
      name: item.name,
      ordered: 0,
      recipeStatus: "missing",
      materials: [],
    };
    product.ordered += Number(item.qty);
    productMap.set(key, product);
  }

  const aggregate = new Map();
  for (const product of productMap.values()) {
    const rows = recipeMap.get(product.productId) || [];
    if (!rows.length) continue;
    product.recipeStatus = "loaded";
    for (const recipe of rows) {
      const perUnit = units(recipe.qty_per_unit);
      if (perUnit <= 0) throw new Error("Receta con cantidad inválida");
      const required = perUnit * product.ordered;
      if (!Number.isSafeInteger(required)) throw new Error("Consumo de insumos fuera de rango");
      const supply = supplyMap.get(recipe.supply_id);
      const row = aggregate.get(recipe.supply_id) || {
        supplyId: recipe.supply_id,
        name: supply?.name || `Insumo ${recipe.supply_id}`,
        unit: supply?.unit || "",
        stock: supply ? units(supply.qty) / SCALE : null,
        available: supply ? (supply.active === false ? 0 : units(supply.qty) / SCALE) : null,
        inactive: supply?.active === false,
        requiredUnits: 0,
        products: [],
      };
      row.requiredUnits += required;
      if (!Number.isSafeInteger(row.requiredUnits)) throw new Error("Consumo total fuera de rango");
      row.products.push({ productId: product.productId, name: product.name, qty: product.ordered });
      aggregate.set(recipe.supply_id, row);
      product.materials.push({ supplyId: recipe.supply_id, required: required / SCALE });
    }
  }

  const materials = [...aggregate.values()].map(({ requiredUnits, ...row }) => {
    const availableUnits = row.available === null ? null : units(row.available);
    return {
      ...row,
      required: requiredUnits / SCALE,
      missing: availableUnits === null ? null : Math.max(0, requiredUnits - availableUnits) / SCALE,
      enough: availableUnits === null ? null : availableUnits >= requiredUnits,
    };
  });
  const materialMap = new Map(materials.map(row => [row.supplyId, row]));
  const products = [...productMap.values()].map(product => ({
    ...product,
    availability: product.recipeStatus === "missing" ? "recipe_missing"
      : product.materials.some(row => materialMap.get(row.supplyId).enough === null) ? "unknown"
      : product.materials.some(row => !materialMap.get(row.supplyId).enough) ? "insufficient"
      : "available",
  }));
  return { basis: "ordered_quantity", products, supplies: materials };
}
