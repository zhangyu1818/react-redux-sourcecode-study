import {
  createStore,
  combineReducers
  // applyMiddleware
} from "redux";
// import { logger } from "redux-logger";

const countReducer = (state = { count: 0 }, action) => {
  if (action.type === "INCREASE") return { ...state, count: state.count + 1 };
  else if (action.type === "DECREASE")
    return { ...state, count: state.count - 1 };
  return state;
};

const stringReducer = (state = { string: "str" }, action) => {
  if (action.type === "SET_STRING")
    return { ...state, string: state.string + "str" };
  return state;
};

const reducers = combineReducers({
  count: countReducer,
  string: stringReducer
});

const store = createStore(
  reducers
  // applyMiddleware(logger)
);

export default store;
