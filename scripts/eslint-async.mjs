// no-floating-promises checks statements; a returned `void promise` in a
// concise arrow is otherwise a loophole. Reject that erasure with real types.
const noVoidPromise = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      rejection:
        "Do not erase a Promise with void; await, return, or attach an explicit rejection handler without void.",
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    const checker = services.program.getTypeChecker();
    return {
      UnaryExpression(node) {
        if (node.operator !== "void") return;
        const expression = services.esTreeNodeToTSNodeMap.get(node.argument);
        const type = checker.getTypeAtLocation(expression);
        const types = type.isUnion() ? type.types : [type];
        if (
          types.some((item) => {
            const then = item.getProperty("then");
            return (
              then &&
              checker
                .getTypeOfSymbolAtLocation(then, expression)
                .getCallSignatures().length > 0
            );
          })
        )
          context.report({ node, messageId: "rejection" });
      },
    };
  },
};
export default noVoidPromise;
