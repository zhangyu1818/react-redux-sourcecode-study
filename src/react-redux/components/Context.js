import React from "react";

// 创建一个context
export const ReactReduxContext = /*#__PURE__*/ React.createContext(null);

if (process.env.NODE_ENV !== "production") {
  ReactReduxContext.displayName = "ReactRedux";
}

export default ReactReduxContext;
