function fail(path, message, errors) {
  errors.push((path || "$") + ": " + message);
}

function validateValue(value, schema, path, errors) {
  if (!schema || typeof schema !== "object") return;
  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.some(x => JSON.stringify(x) === JSON.stringify(value))) {
    fail(path, "must match one of the allowed enum values.", errors);
    return;
  }

  const type = schema.type;
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail(path, "must be an object.", errors);
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
    for (const required of Array.isArray(schema.required) ? schema.required : []) {
      if (!(required in value)) fail(path + "." + required, "is required.", errors);
    }
    for (const [key, child] of Object.entries(properties)) {
      if (key in value) validateValue(value[key], child, path + "." + key, errors);
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) return fail(path, "must be an array.", errors);
    if (schema.minItems != null && value.length < Number(schema.minItems)) fail(path, "has fewer items than allowed.", errors);
    if (schema.maxItems != null && value.length > Number(schema.maxItems)) fail(path, "has more items than allowed.", errors);
    if (schema.items) value.forEach((item, index) => validateValue(item, schema.items, path + "[" + index + "]", errors));
  } else if (type === "string") {
    if (typeof value !== "string") return fail(path, "must be a string.", errors);
    if (schema.minLength != null && value.length < Number(schema.minLength)) fail(path, "is shorter than allowed.", errors);
    if (schema.maxLength != null && value.length > Number(schema.maxLength)) fail(path, "is longer than allowed.", errors);
    if (schema.pattern) {
      try {
        if (!(new RegExp(schema.pattern)).test(value)) fail(path, "does not match the required pattern.", errors);
      } catch {
        fail(path, "uses an invalid schema pattern.", errors);
      }
    }
  } else if (type === "number" && (typeof value !== "number" || Number.isNaN(value))) fail(path, "must be a number.", errors);
  else if (type === "integer" && (!Number.isInteger(value))) fail(path, "must be an integer.", errors);
  else if (type === "boolean" && typeof value !== "boolean") fail(path, "must be a boolean.", errors);
}

export function validateStructuredOutput(value, schema) {
  if (!schema || typeof schema !== "object" || Object.keys(schema).length === 0) {
    return { valid: true, errors: [] };
  }
  const errors = [];
  validateValue(value, schema, "$", errors);
  return { valid: errors.length === 0, errors };
}

export function assertStructuredOutput(value, schema, label = "Generated output") {
  const result = validateStructuredOutput(value, schema);
  if (!result.valid) throw new Error(label + " failed schema validation: " + result.errors.join(" "));
  return value;
}
