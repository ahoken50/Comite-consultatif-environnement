import { combineReducers } from '@reduxjs/toolkit';
import authReducer from '../features/auth/authSlice';
import projectsReducer from '../features/projects/projectsSlice';
import meetingsReducer from '../features/meetings/meetingsSlice';
import documentsReducer from '../features/documents/documentsSlice';

import membersReducer from '../features/members/membersSlice';
import settingsReducer from '../features/settings/settingsSlice';

const rootReducer = combineReducers({
    auth: authReducer,
    projects: projectsReducer,
    meetings: meetingsReducer,
    documents: documentsReducer,
    members: membersReducer,
    settings: settingsReducer,
});

export type RootState = ReturnType<typeof rootReducer>;
export default rootReducer;
