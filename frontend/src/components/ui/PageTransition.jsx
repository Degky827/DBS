import { motion, useReducedMotion } from "motion/react";
import { fadeVariants, staggerContainer, staggerItem } from "./motionVariants";

export default function PageTransition({ children, className = "", as = "div", ...rest }) {
  const reduceMotion = useReducedMotion();
  const Component = motion[as] || motion.div;

  if (reduceMotion) {
    const Tag = as === "div" ? "div" : as;
    return (
      <Tag className={className} {...rest}>
        {children}
      </Tag>
    );
  }

  return (
    <Component
      className={className}
      variants={fadeVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={{ duration: 0.26, ease: [0.22, 0.61, 0.36, 1] }}
      {...rest}
    >
      {children}
    </Component>
  );
}

export function StaggerItem({ children, className = "", as = "div", ...rest }) {
  const reduceMotion = useReducedMotion();
  const Component = motion[as] || motion.div;

  if (reduceMotion) {
    const Tag = as === "div" ? "div" : as;
    return (
      <Tag className={className} {...rest}>
        {children}
      </Tag>
    );
  }

  return (
    <Component className={className} variants={staggerItem} {...rest}>
      {children}
    </Component>
  );
}

export function StaggerGroup({ children, className = "", as = "div", ...rest }) {
  const reduceMotion = useReducedMotion();
  const Component = motion[as] || motion.div;
  const Tag = as === "div" ? "div" : as;

  if (reduceMotion) {
    return (
      <Tag className={className} {...rest}>
        {children}
      </Tag>
    );
  }

  return (
    <Component
      className={className}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      {...rest}
    >
      {children}
    </Component>
  );
}
