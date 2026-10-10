import type { BuilderNode } from './core/schema';

const checkoutAnchors = new Set(['order', 'order-form', 'checkout', 'landing-checkout']);
const hasCheckoutAnchor = (node: BuilderNode): boolean => checkoutAnchors.has(node.attributes.id) || node.children.some(hasCheckoutAnchor);
const containsForm = (node: BuilderNode): boolean => ['form', 'form-field', 'form-submit'].includes(node.type) || node.children.some(containsForm);

/** Old imported designs may contain a decorative checkout placeholder. The real
 * checkout is rendered by the storefront; reserve its anchors without changing
 * the saved document or dropping unrelated design content. */
export function landingCheckoutDesign(nodes: BuilderNode[]): BuilderNode[] {
  return nodes.filter(node => {
    if (['form', 'form-field', 'form-submit'].includes(node.type)) return false;
    const name = node.name || '';
    if (containsForm(node) && /(?:order|checkout).*(?:form|section)|(?:form|section).*(?:order|checkout)/i.test(name)) return false;
    return !(/checkout.*anchor.*(?:container|section)/i.test(name) && hasCheckoutAnchor(node));
  }).map(node => {
    const attributes = { ...node.attributes };
    if (checkoutAnchors.has(attributes.id)) delete attributes.id;
    return { ...node, attributes, children: landingCheckoutDesign(node.children) };
  });
}
