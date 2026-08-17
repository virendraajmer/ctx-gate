type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

function loadOrder(id: string): Result<Order, NotFoundError> {
  const order = findOrder(id);
  if (!order) {
    return { ok: false, error: new NotFoundError(id) };
  }
  return { ok: true, value: order };
}
